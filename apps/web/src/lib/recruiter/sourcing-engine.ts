import type { SupabaseClient } from '@supabase/supabase-js'
import { embedTexts, getOpenAIApiKey } from '@/lib/openai'
import { sendRecruiterEmail } from '@/lib/email'
import { logSystemEvent } from '@/lib/system-events'
import type { AgentConfig, Unit } from '@/lib/types'
import { getSmarterApiConfig, fetchSmarterCandidates, type SmarterCandidate } from './smarter-api'
import { getJobBoardProviders, briefingToHtml } from './job-boards'
import { scoreCandidatesForJob } from './scoring-engine'
import { getRecruiterLimits } from './guardrails'
import { logDecision, logRecruiterEvent } from './log'
import type { Candidate, JobOpening, JobProfile } from './types'

// Sourcing Engine (§7.3/§7.4): sincroniza candidatos da API autorizada
// da Smarter, garante embeddings e executa o ranking em 3 estágios
// (filtros SQL → recall pgvector → rubrica LLM). Caps por execução
// mantêm cada chamada dentro do tempo de função da Vercel — o cron de
// reconciliação completa o que faltar.

const SYNC_LIMIT = 150
const EMBED_BATCH_LIMIT = 100
const RECALL_LIMIT = 30
const SCORE_LIMIT = 18

/** Texto usado no embedding do candidato (mesmo formato do texto do perfil da vaga). */
export function buildCandidateEmbeddingText(candidate: {
  course?: string | null
  semester?: number | null
  institution?: string | null
  city?: string | null
  skills?: string[] | null
  languages?: string[] | null
  experience_summary?: string | null
  disc_profile?: string | null
}): string {
  return [
    candidate.course ? `Curso: ${candidate.course}${candidate.semester ? ` (${candidate.semester}º semestre)` : ''}` : null,
    candidate.institution ? `Instituição: ${candidate.institution}` : null,
    candidate.city ? `Cidade: ${candidate.city}` : null,
    candidate.skills?.length ? `Habilidades: ${candidate.skills.join(', ')}` : null,
    candidate.languages?.length ? `Idiomas: ${candidate.languages.join(', ')}` : null,
    candidate.experience_summary ? `Experiência: ${candidate.experience_summary}` : null,
    candidate.disc_profile ? `Perfil DISC: ${candidate.disc_profile}` : null,
  ]
    .filter(Boolean)
    .join('. ')
}

export function buildProfileSearchText(title: string, profile: JobProfile): string {
  return [
    `Vaga: ${title}`,
    profile.course ? `Curso: ${profile.course}` : null,
    profile.city ? `Cidade: ${profile.city}${profile.modality ? ` (${profile.modality})` : ''}` : null,
    profile.hard_skills?.length ? `Habilidades: ${profile.hard_skills.join(', ')}` : null,
    profile.tools?.length ? `Ferramentas: ${profile.tools.join(', ')}` : null,
    profile.languages?.length ? `Idiomas: ${profile.languages.join(', ')}` : null,
    profile.soft_skills?.length ? `Soft skills: ${profile.soft_skills.join(', ')}` : null,
    profile.behavioral_profile ? `Perfil comportamental: ${profile.behavioral_profile}` : null,
    profile.experience ? `Experiência: ${profile.experience}` : null,
    profile.competencies?.length ? `Competências: ${profile.competencies.join(', ')}` : null,
  ]
    .filter(Boolean)
    .join('. ')
}

function normalizeContact(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '')
}

/**
 * Divide o curso do perfil em termos de busca individuais para o filtro
 * duro SQL: "Marketing ou Publicidade" → ['Marketing', 'Publicidade'].
 * Sem isso, um perfil com cursos alternativos não casaria com ninguém.
 */
export function courseSearchTerms(course: string | null | undefined): string[] | null {
  if (!course) return null
  const terms = course
    .split(/\s*(?:,|\/|\bou\b|\be\b)\s*/i)
    .map((term) => term.trim())
    .filter((term) => term.length > 2)
  return terms.length > 0 ? terms : null
}

/**
 * A API da Smarter é dado de parceria, não uma fonte global: só organizações
 * marcadas como clientes/franquias da Smarter (organizations.is_smarter_partner)
 * podem consultá-la. Demais organizações (ex.: Mawi Services) usam só a base
 * própria de candidatos, mesmo com as envs SMARTER_CANDIDATES_API_* configuradas
 * globalmente no projeto Vercel.
 */
async function isSmarterPartnerOrg(supabase: SupabaseClient, orgId: string): Promise<boolean> {
  const { data } = await supabase.from('organizations').select('is_smarter_partner').eq('id', orgId).maybeSingle()
  return (data as { is_smarter_partner: boolean } | null)?.is_smarter_partner ?? false
}

/**
 * Sincroniza candidatos da API da Smarter para `candidates` (upsert por
 * org+source+external_ref, com dedupe adicional por telefone/e-mail —
 * exceção 8 da spec: mantém o registro existente e enriquece campos vazios).
 * Sem env configurada, ou para organizações que não são parceiras da Smarter,
 * degrada graciosamente (sem chamada de API).
 */
export async function syncSmarterCandidates(
  supabase: SupabaseClient,
  params: { orgId: string; unitId?: string | null; course?: string | null; city?: string | null; updatedSince?: string | null },
): Promise<{ synced: number; skippedNoConsent: number } | null> {
  const isPartner = await isSmarterPartnerOrg(supabase, params.orgId)
  if (!isPartner) return null

  const apiConfig = getSmarterApiConfig()
  if (!apiConfig) {
    await logSystemEvent(supabase, {
      level: 'warning',
      source: 'recruiter',
      eventType: 'smarter_api_not_configured',
      message:
        'SMARTER_CANDIDATES_API_URL/TOKEN não configuradas — sourcing usando apenas a base própria de candidatos.',
      orgId: params.orgId,
      unitId: params.unitId ?? null,
    })
    return null
  }

  const rows = await fetchSmarterCandidates(apiConfig, {
    course: params.course,
    city: params.city,
    updatedSince: params.updatedSince,
    limit: SYNC_LIMIT,
  })

  // Candidatos sem consentimento de compartilhamento não são materializados (LGPD §18)
  const consented = rows.filter((row) => (row.consent_status ?? 'granted') !== 'revoked')
  const skippedNoConsent = rows.length - consented.length
  if (consented.length === 0) return { synced: 0, skippedNoConsent }

  const { data: existing } = await supabase
    .from('candidates')
    .select('id, external_ref, phone, email')
    .eq('org_id', params.orgId)

  const existingRows = (existing as { id: string; external_ref: string | null; phone: string | null; email: string | null }[] | null) ?? []
  const byRef = new Map(existingRows.filter((r) => r.external_ref).map((r) => [r.external_ref as string, r.id]))
  const byPhone = new Map(existingRows.filter((r) => normalizeContact(r.phone)).map((r) => [normalizeContact(r.phone), r.id]))
  const byEmail = new Map(
    existingRows.filter((r) => r.email).map((r) => [(r.email as string).toLowerCase(), r.id]),
  )

  let synced = 0
  for (const row of consented) {
    const payload = smarterToCandidateRow(params.orgId, row)
    const existingId =
      byRef.get(row.id) ??
      byPhone.get(normalizeContact(row.phone)) ??
      (row.email ? byEmail.get(row.email.toLowerCase()) : undefined)

    if (existingId) {
      // enriquece sem sobrescrever com nulos; embedding será regenerado
      const { error } = await supabase
        .from('candidates')
        .update({ ...stripNulls(payload), profile_embedding: null })
        .eq('id', existingId)
      if (!error) synced += 1
    } else {
      const { error } = await supabase.from('candidates').insert(payload)
      if (!error) synced += 1
    }
  }

  return { synced, skippedNoConsent }
}

function smarterToCandidateRow(orgId: string, row: SmarterCandidate) {
  return {
    org_id: orgId,
    source: 'smarter_api',
    external_ref: row.id,
    name: row.name,
    email: row.email ?? null,
    phone: row.phone ?? null,
    city: row.city ?? null,
    state: row.state ?? null,
    course: row.course ?? null,
    semester: row.semester ?? null,
    institution: row.institution ?? null,
    skills: row.skills ?? [],
    languages: row.languages ?? [],
    experience_summary: row.experience_summary ?? null,
    disc_profile: row.disc_profile ?? null,
    resume_url: row.resume_url ?? null,
    consent_status: row.consent_status === 'granted' ? 'granted' : (row.consent_status ?? 'granted'),
    consent_at: row.consent_at ?? null,
  }
}

function stripNulls<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const clean: Partial<T> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (value !== null && value !== undefined && !(Array.isArray(value) && value.length === 0)) {
      clean[key as keyof T] = value as T[keyof T]
    }
  }
  return clean
}

/** Gera embeddings para candidatos ainda sem vetor (em lote, com cap). */
export async function ensureCandidateEmbeddings(
  supabase: SupabaseClient,
  orgId: string,
): Promise<number> {
  const apiKey = getOpenAIApiKey()
  if (!apiKey) throw new Error('OPENAI_API_KEY não está configurada.')

  const { data } = await supabase
    .from('candidates')
    .select('id, course, semester, institution, city, skills, languages, experience_summary, disc_profile')
    .eq('org_id', orgId)
    .is('profile_embedding', null)
    .limit(EMBED_BATCH_LIMIT)

  const rows = (data as Partial<Candidate>[] | null) ?? []
  if (rows.length === 0) return 0

  const texts = rows.map((row) => buildCandidateEmbeddingText(row) || 'perfil sem dados')
  const embeddings = await embedTexts(apiKey, texts)

  let updated = 0
  for (let i = 0; i < rows.length; i += 1) {
    const embedding = embeddings[i]
    if (!embedding) continue
    const { error } = await supabase
      .from('candidates')
      .update({ profile_embedding: JSON.stringify(embedding) })
      .eq('id', rows[i]!.id)
    if (!error) updated += 1
  }
  return updated
}

/** Memória relacional da empresa (§10): injetada no prompt de ranking. */
async function getCompanyMemory(supabase: SupabaseClient, job: JobOpening): Promise<string | null> {
  if (!job.lead_id) return null
  const { data } = await supabase
    .from('company_recruiting_profiles')
    .select('preferences, rejection_patterns')
    .eq('org_id', job.org_id)
    .eq('lead_id', job.lead_id)
    .maybeSingle()

  if (!data) return null
  const prefs = data.preferences && Object.keys(data.preferences).length > 0 ? JSON.stringify(data.preferences) : null
  const rejections =
    Array.isArray(data.rejection_patterns) && data.rejection_patterns.length > 0
      ? JSON.stringify(data.rejection_patterns)
      : null
  if (!prefs && !rejections) return null
  return [
    prefs ? `Esta empresa historicamente valoriza: ${prefs}.` : null,
    rejections ? `Esta empresa já reprovou candidatos por: ${rejections}.` : null,
  ]
    .filter(Boolean)
    .join(' ')
}

export type SourcingResult = {
  totalRanked: number
  qualified: number
  expanded: boolean
}

/**
 * Executa o funil completo de sourcing para uma vaga com perfil pronto:
 * sync Smarter → embeddings → recall pgvector → rubrica LLM →
 * job_candidates ranqueados. Se qualified < meta, dispara a expansão
 * (V1: briefing de busca externa para humano — ver job-boards.ts).
 */
export async function runSourcing(
  supabase: SupabaseClient,
  params: { job: JobOpening; unit: Unit; config: AgentConfig },
): Promise<SourcingResult> {
  const { job, unit, config } = params
  const apiKey = getOpenAIApiKey()
  if (!apiKey) throw new Error('OPENAI_API_KEY não está configurada.')

  const limits = getRecruiterLimits(config)

  await supabase.from('job_openings').update({ status: 'sourcing' }).eq('id', job.id)

  // 1. Sincroniza a base autorizada da Smarter (graciosamente degradável)
  try {
    const sync = await syncSmarterCandidates(supabase, {
      orgId: job.org_id,
      unitId: job.unit_id,
      course: job.profile.course,
      city: job.profile.city,
    })
    if (sync) {
      await logRecruiterEvent(supabase, {
        orgId: job.org_id,
        unitId: job.unit_id,
        jobId: job.id,
        eventType: 'sourcing.smarter_synced',
        message: `${sync.synced} candidatos sincronizados da API Smarter (${sync.skippedNoConsent} sem consentimento, ignorados).`,
      })
    }
  } catch (error) {
    await logSystemEvent(supabase, {
      level: 'error',
      source: 'recruiter',
      eventType: 'smarter_api_error',
      message: `Falha ao sincronizar candidatos da API Smarter: ${error instanceof Error ? error.message : 'erro desconhecido'}`,
      orgId: job.org_id,
      unitId: job.unit_id,
      metadata: { job_id: job.id },
    })
  }

  // 2. Embeddings pendentes
  await ensureCandidateEmbeddings(supabase, job.org_id)

  // 3. Estágios 1+2 — filtros duros + recall semântico (RPC match_candidates_for_job)
  const [profileEmbedding] = await embedTexts(apiKey, [buildProfileSearchText(job.title, job.profile)])
  const { data: matches, error: matchError } = await supabase.rpc('match_candidates_for_job', {
    p_org_id: job.org_id,
    p_embedding: JSON.stringify(profileEmbedding),
    p_courses: courseSearchTerms(job.profile.course),
    p_city: job.profile.modality === 'remoto' ? null : (job.profile.city ?? null),
    p_semester_min: job.profile.semester_min ?? null,
    p_semester_max: job.profile.semester_max ?? null,
    p_limit: RECALL_LIMIT,
  })
  if (matchError) throw new Error(`match_candidates_for_job: ${matchError.message}`)

  const matchRows = (matches as { candidate_id: string; similarity: number }[] | null) ?? []

  // Não re-adiciona candidatos que já estão no pipeline desta vaga
  const { data: existingJc } = await supabase
    .from('job_candidates')
    .select('candidate_id')
    .eq('job_id', job.id)
  const alreadyInPipeline = new Set(((existingJc as { candidate_id: string }[] | null) ?? []).map((r) => r.candidate_id))
  const newMatches = matchRows.filter((m) => !alreadyInPipeline.has(m.candidate_id)).slice(0, SCORE_LIMIT)

  let totalRanked = 0
  let qualified = 0

  if (newMatches.length > 0) {
    const { data: candidateRows } = await supabase
      .from('candidates')
      .select('*')
      .in('id', newMatches.map((m) => m.candidate_id))

    const candidates = (candidateRows as Candidate[] | null) ?? []

    // 4. Estágio 3 — rubrica LLM
    const companyMemory = await getCompanyMemory(supabase, job)
    const scored = await scoreCandidatesForJob({ supabase, job, candidates, companyMemory })

    const baseRank = alreadyInPipeline.size
    for (let i = 0; i < scored.length; i += 1) {
      const item = scored[i]!
      const { error } = await supabase.from('job_candidates').insert({
        job_id: job.id,
        candidate_id: item.candidateId,
        unit_id: job.unit_id,
        stage: 'ranked',
        stage_reason: 'ranqueado pelo funil de sourcing (filtros + embeddings + rubrica)',
        match_score: item.matchScore,
        rank: baseRank + i + 1,
        score_breakdown: { dimensions: item.dimensions },
      })
      if (!error) {
        totalRanked += 1
        if (item.matchScore >= limits.match_score_qualified) qualified += 1
      }
    }
  }

  await logRecruiterEvent(supabase, {
    orgId: job.org_id,
    unitId: job.unit_id,
    jobId: job.id,
    eventType: 'sourcing.completed',
    message: `Sourcing interno concluído: ${totalRanked} candidatos ranqueados, ${qualified} qualificados (match ≥ ${limits.match_score_qualified}).`,
    metadata: { recall: matchRows.length, ranked: totalRanked, qualified },
  })

  // 5. Expansão externa quando a base interna é insuficiente (§7.4)
  let expanded = false
  if (qualified < limits.sourcing_qualified_target) {
    expanded = true
    await expandSourcing(supabase, { job, unit, qualified, target: limits.sourcing_qualified_target })
  }

  // Segue com o que tem (nunca infla shortlist com candidato ruim);
  // sem nenhum candidato o processo trava e escala visibilidade.
  const nextStatus = totalRanked + alreadyInPipeline.size > 0 ? 'outreach' : 'stalled'
  await supabase
    .from('job_openings')
    .update({
      status: nextStatus,
      stalled_since: nextStatus === 'stalled' ? new Date().toISOString() : null,
    })
    .eq('id', job.id)

  if (nextStatus === 'stalled') {
    await logDecision(supabase, {
      orgId: job.org_id,
      unitId: job.unit_id,
      jobId: job.id,
      decisionType: 'stalled',
      reasoning:
        'Nenhum candidato compatível encontrado na base interna e a busca externa automática não está disponível (sem API oficial). Aguardando cadastro manual de candidatos a partir do briefing enviado.',
    })
  }

  return { totalRanked, qualified, expanded }
}

/**
 * Expansão de sourcing (decisão autônoma, sempre logada). V1: gera o
 * briefing de busca e envia ao humano responsável — ver a nota de
 * limitação em job-boards.ts.
 */
async function expandSourcing(
  supabase: SupabaseClient,
  params: { job: JobOpening; unit: Unit; qualified: number; target: number },
): Promise<void> {
  const { job, unit, qualified, target } = params

  await logDecision(supabase, {
    orgId: job.org_id,
    unitId: job.unit_id,
    jobId: job.id,
    decisionType: 'expand_sourcing',
    reasoning: `Apenas ${qualified} candidatos qualificados na base interna (meta: ${target}). Expandindo a busca para fontes externas via briefing assistido — Indeed/InfoJobs não têm API pública de currículos e scraping é proibido.`,
    metadata: { qualified, target },
  })

  for (const provider of getJobBoardProviders()) {
    if (!provider.isAvailable()) continue
    const outcome = await provider.searchCandidates(job)

    if (outcome.kind === 'manual_briefing') {
      const { data: org } = await supabase
        .from('organizations')
        .select('owner_email')
        .eq('id', job.org_id)
        .maybeSingle()
      const ownerEmail = (org as { owner_email: string | null } | null)?.owner_email

      if (ownerEmail) {
        await sendRecruiterEmail({
          to: ownerEmail,
          subject: `[${unit.name}] Vaga "${job.title}": busca externa de candidatos precisa de você`,
          html: briefingToHtml(outcome.briefing),
        })
      }

      await logRecruiterEvent(supabase, {
        orgId: job.org_id,
        unitId: job.unit_id,
        jobId: job.id,
        eventType: 'sourcing.expanded',
        message: `Briefing de busca externa gerado e ${ownerEmail ? `enviado para ${ownerEmail}` : 'registrado (org sem owner_email — visível apenas no dashboard)'}.`,
        metadata: { provider: provider.name, briefing: outcome.briefing },
      })
    }
    // kind === 'candidates': providers de API oficial (V2) entram no
    // mesmo funil — materializar em candidates e re-rodar o ranking.
  }
}
