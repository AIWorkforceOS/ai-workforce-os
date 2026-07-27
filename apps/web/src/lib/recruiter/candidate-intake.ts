import type { SupabaseClient } from '@supabase/supabase-js'
import { getOpenAIApiKey } from '@/lib/openai'
import { ensureCandidateEmbeddings, getCompanyMemory } from './sourcing-engine'
import { scoreCandidatesForJob } from './scoring-engine'
import { logRecruiterEvent } from './log'
import type { Candidate, JobOpening } from './types'

// Intake de candidato independente da Smarter (auditoria, gap fase 3/3):
// duas fontes novas — cadastro manual pelo dono/RH e candidatura pública
// por vaga — que entram no MESMO pipeline job_candidates/scoring rubric
// que hoje só é alimentado pela API da Smarter (sourcing-engine.ts). Não
// é um pipeline paralelo: a única diferença é que o candidato já chegou
// vinculado a uma vaga específica, então pula o recall semântico
// (match_candidates_for_job) e vai direto para a rubrica de pontuação.

export const CANDIDATE_SOURCE_MANUAL = 'manual'
export const CANDIDATE_SOURCE_PUBLIC_APPLICATION = 'public_application'

/** Vagas que não aceitam novas candidaturas (preenchida ou encerrada). */
export const CLOSED_FOR_APPLICATION_STATUSES = [
  'closed',
  'cancelled',
  'expired',
  'handed_off',
  'candidate_selected',
]

function normalizePhone(value: string | null | undefined): string | null {
  const digits = (value ?? '').replace(/\D/g, '')
  return digits.length >= 8 ? digits : null
}

function normalizeEmail(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim().toLowerCase()
  return trimmed.length > 0 ? trimmed : null
}

export type CandidateIntakeInput = {
  orgId: string
  source: typeof CANDIDATE_SOURCE_MANUAL | typeof CANDIDATE_SOURCE_PUBLIC_APPLICATION
  name: string
  email?: string | null
  phone?: string | null
  resumeUrl?: string | null
  notes?: string | null
}

/**
 * Cria (ou reaproveita, por telefone/e-mail dentro da org — mesmo
 * critério de dedupe de syncSmarterCandidates) o registro em
 * `candidates`. Nunca sobrescreve dado existente, só enriquece campos
 * vazios (currículo), preservando o histórico do candidato se ele já
 * veio de outra fonte antes.
 */
export async function findOrCreateCandidate(
  supabase: SupabaseClient,
  input: CandidateIntakeInput,
): Promise<{ candidateId: string; created: boolean }> {
  const phone = normalizePhone(input.phone)
  const email = normalizeEmail(input.email)

  let existing: { id: string; resume_url: string | null } | null = null
  if (phone) {
    const { data } = await supabase
      .from('candidates')
      .select('id, resume_url')
      .eq('org_id', input.orgId)
      .eq('phone', phone)
      .maybeSingle()
    existing = data
  }
  if (!existing && email) {
    const { data } = await supabase
      .from('candidates')
      .select('id, resume_url')
      .eq('org_id', input.orgId)
      .eq('email', email)
      .maybeSingle()
    existing = data
  }

  if (existing) {
    if (input.resumeUrl && !existing.resume_url) {
      await supabase.from('candidates').update({ resume_url: input.resumeUrl }).eq('id', existing.id)
    }
    return { candidateId: existing.id, created: false }
  }

  const { data: inserted, error } = await supabase
    .from('candidates')
    .insert({
      org_id: input.orgId,
      source: input.source,
      name: input.name,
      email,
      phone,
      resume_url: input.resumeUrl ?? null,
      experience_summary: input.notes ?? null,
      consent_status: 'granted',
      consent_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (error || !inserted) {
    throw new Error(error?.message ?? 'Erro ao cadastrar candidato.')
  }

  return { candidateId: (inserted as { id: string }).id, created: true }
}

export type AddToPipelineResult =
  | { ok: true; stage: 'ranked' | 'sourced'; matchScore: number | null }
  | { ok: false; error: string }

/**
 * Adiciona um candidato já existente (`candidates`) ao pipeline de uma
 * vaga específica (`job_candidates`), reaproveitando a MESMA rubrica de
 * pontuação do sourcing automático (scoreCandidatesForJob) — só que sem
 * o recall semântico (match_candidates_for_job), porque o candidato já
 * chegou vinculado a esta vaga (candidatura direta ou cadastro manual),
 * não precisa ser "encontrado" entre a base toda. Resultado: mesmo
 * stage machine, mesmo score_breakdown, mesma fila de outreach do cron
 * (sendOutreachBatch só olha stage = 'ranked').
 *
 * Se OPENAI_API_KEY não estiver configurada, degrada graciosamente:
 * entra como 'sourced' (visível no pipeline, mas sem nota) em vez de
 * falhar — o cron inteiro do Recruiter já exige a mesma env, então não
 * há como pontuar de qualquer forma até ela ser configurada.
 */
export async function addCandidateToJobPipeline(
  supabase: SupabaseClient,
  params: { job: JobOpening; candidateId: string },
): Promise<AddToPipelineResult> {
  const { job, candidateId } = params

  const { data: existingJc } = await supabase
    .from('job_candidates')
    .select('id')
    .eq('job_id', job.id)
    .eq('candidate_id', candidateId)
    .maybeSingle()
  if (existingJc) {
    return { ok: false, error: 'Este candidato já está no pipeline desta vaga.' }
  }

  const { count: currentCount } = await supabase
    .from('job_candidates')
    .select('id', { count: 'exact', head: true })
    .eq('job_id', job.id)
  const nextRank = (currentCount ?? 0) + 1

  let stage: 'ranked' | 'sourced' = 'sourced'
  let stageReason = 'Candidatura recebida — aguardando pontuação (OPENAI_API_KEY não configurada).'
  let matchScore: number | null = null
  let dimensions: Record<string, unknown> = {}

  const apiKey = getOpenAIApiKey()
  if (apiKey) {
    try {
      await ensureCandidateEmbeddings(supabase, job.org_id)
      const { data: candidateRow } = await supabase
        .from('candidates')
        .select('*')
        .eq('id', candidateId)
        .maybeSingle()
      const candidate = candidateRow as Candidate | null

      if (candidate) {
        const companyMemory = await getCompanyMemory(supabase, job)
        const [scored] = await scoreCandidatesForJob({ supabase, job, candidates: [candidate], companyMemory })
        if (scored) {
          stage = 'ranked'
          matchScore = scored.matchScore
          dimensions = scored.dimensions
          stageReason = 'Candidatura direta — ranqueado pela mesma rubrica do sourcing automático.'
        } else {
          stageReason = 'Candidatura recebida — falha ao pontuar automaticamente; revisar manualmente.'
        }
      }
    } catch (error) {
      stageReason = `Candidatura recebida — pontuação automática falhou (${error instanceof Error ? error.message : 'erro desconhecido'}).`
    }
  }

  const { data: jcInserted, error } = await supabase
    .from('job_candidates')
    .insert({
      job_id: job.id,
      candidate_id: candidateId,
      unit_id: job.unit_id,
      stage,
      stage_reason: stageReason,
      match_score: matchScore,
      rank: nextRank,
      score_breakdown: { dimensions },
    })
    .select('id')
    .single()

  if (error || !jcInserted) {
    return { ok: false, error: error?.message ?? 'Erro ao adicionar candidato ao pipeline.' }
  }

  await logRecruiterEvent(supabase, {
    orgId: job.org_id,
    unitId: job.unit_id,
    jobId: job.id,
    candidateId,
    eventType: 'candidate.added_alternate_source',
    message: `Candidato entrou no pipeline por fonte alternativa à Smarter (${stage === 'ranked' ? `match ${matchScore}` : 'sem pontuação'}).`,
  })

  // Vaga tinha travado por falta de candidato — a chegada de um novo
  // candidato pontuado destrava para o cron voltar a contatar.
  if (job.status === 'stalled' && stage === 'ranked') {
    await supabase
      .from('job_openings')
      .update({ status: 'outreach', stalled_since: null })
      .eq('id', job.id)
  }

  return { ok: true, stage, matchScore }
}
