import type { SupabaseClient } from '@supabase/supabase-js'
import { generateStructuredReply, getOpenAIApiKey } from '@/lib/openai'
import { buildRankingPrompt } from './prompts'
import {
  SCORING_RUBRIC,
  type Candidate,
  type JobOpening,
  type ScoreDimension,
} from './types'

// Estágio 3 do ranking (§8.2): rubrica LLM com pesos fixos e
// justificativa por dimensão — o ranking é sempre explicável.
//
// Conformidade (§8.2): atributos protegidos NÃO entram no contexto de
// avaliação. Os candidatos são apresentados ao modelo como referências
// anônimas (C1, C2...) apenas com dados profissionais; nome, telefone e
// e-mail ficam fora do prompt.

const RANKING_MODEL = process.env.RECRUITER_RANKING_MODEL || 'gpt-4o'
const BATCH_SIZE = 6

export type PlatformHistory = { processes: number; shortlisted: number; approved: number; noShows: number }

/** Histórico do candidato na plataforma (fator "platform_history" da rubrica). */
export async function getPlatformHistory(
  supabase: SupabaseClient,
  candidateIds: string[],
): Promise<Map<string, PlatformHistory>> {
  const history = new Map<string, PlatformHistory>()
  if (candidateIds.length === 0) return history

  const { data } = await supabase
    .from('job_candidates')
    .select('candidate_id, stage, stage_reason')
    .in('candidate_id', candidateIds)

  for (const row of (data as { candidate_id: string; stage: string; stage_reason: string | null }[] | null) ?? []) {
    const entry = history.get(row.candidate_id) ?? { processes: 0, shortlisted: 0, approved: 0, noShows: 0 }
    entry.processes += 1
    if (['shortlisted', 'presented', 'approved', 'not_selected'].includes(row.stage)) entry.shortlisted += 1
    if (row.stage === 'approved') entry.approved += 1
    if (row.stage === 'unreachable' || /no.?show/i.test(row.stage_reason ?? '')) entry.noShows += 1
    history.set(row.candidate_id, entry)
  }
  return history
}

/** Payload de avaliação sem atributos protegidos nem identificação direta. */
function candidateEvaluationPayload(candidate: Candidate, history: PlatformHistory | undefined) {
  return {
    course: candidate.course,
    semester: candidate.semester,
    institution: candidate.institution,
    city: candidate.city,
    state: candidate.state,
    skills: candidate.skills,
    languages: candidate.languages,
    experience_summary: candidate.experience_summary,
    disc_profile: candidate.disc_profile,
    platform_history: history
      ? `${history.processes} processos anteriores, ${history.shortlisted} shortlists, ${history.approved} aprovações, ${history.noShows} não-comparecimentos`
      : 'sem histórico na plataforma (neutro)',
  }
}

export function computeWeightedScore(dimensions: Record<string, ScoreDimension>): number {
  let total = 0
  let weightSum = 0
  for (const dim of SCORING_RUBRIC) {
    const entry = dimensions[dim.key]
    if (!entry || !Number.isFinite(entry.score)) continue
    total += Math.max(0, Math.min(100, entry.score)) * dim.weight
    weightSum += dim.weight
  }
  if (weightSum === 0) return 0
  return Math.round((total / weightSum) * 100) / 100
}

export type ScoredCandidate = {
  candidateId: string
  matchScore: number
  dimensions: Record<string, ScoreDimension>
}

type RankingResponse = {
  results?: { ref?: string; dimensions?: Record<string, ScoreDimension> }[]
}

/**
 * Pontua candidatos contra a rubrica, em lotes, e devolve match_score
 * ponderado + breakdown. Falha de um lote não derruba os demais.
 */
export async function scoreCandidatesForJob(params: {
  supabase: SupabaseClient
  job: JobOpening
  candidates: Candidate[]
  companyMemory?: string | null
}): Promise<ScoredCandidate[]> {
  const apiKey = getOpenAIApiKey()
  if (!apiKey) throw new Error('OPENAI_API_KEY não está configurada.')
  if (params.candidates.length === 0) return []

  const historyMap = await getPlatformHistory(
    params.supabase,
    params.candidates.map((c) => c.id),
  )

  const systemPrompt = buildRankingPrompt({
    job: params.job,
    companyMemory: params.companyMemory ?? null,
  })

  const scored: ScoredCandidate[] = []

  for (let offset = 0; offset < params.candidates.length; offset += BATCH_SIZE) {
    const batch = params.candidates.slice(offset, offset + BATCH_SIZE)
    const refs = batch.map((candidate, index) => ({
      ref: `C${offset + index + 1}`,
      candidate,
    }))

    const userContent = JSON.stringify(
      refs.map(({ ref, candidate }) => ({
        ref,
        ...candidateEvaluationPayload(candidate, historyMap.get(candidate.id)),
      })),
    )

    try {
      const response = await generateStructuredReply<RankingResponse>({
        apiKey,
        systemPrompt,
        history: [{ role: 'user', content: `Avalie este lote de candidatos: ${userContent}` }],
        model: RANKING_MODEL,
        maxTokens: 3000,
      })

      for (const result of response.results ?? []) {
        const match = refs.find((r) => r.ref === result.ref)
        if (!match || !result.dimensions) continue
        scored.push({
          candidateId: match.candidate.id,
          matchScore: computeWeightedScore(result.dimensions),
          dimensions: result.dimensions,
        })
      }
    } catch (error) {
      console.error(
        `[recruiter_scoring] falha ao pontuar lote ${offset / BATCH_SIZE + 1}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  return scored.sort((a, b) => b.matchScore - a.matchScore)
}
