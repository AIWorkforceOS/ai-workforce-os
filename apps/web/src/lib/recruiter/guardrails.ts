import type { SupabaseClient } from '@supabase/supabase-js'
import { isWithinActiveHours, countSentToday } from '@/lib/conversation-engine'
import type { AgentConfig } from '@/lib/types'
import { DEFAULT_RECRUITER_LIMITS, type Candidate, type RecruiterLimits } from './types'

// Guard-rails do Recruiter (§11 e §15 da spec): toda tool com efeito
// externo (mensagem, e-mail) passa por aqui ANTES de executar — em
// código, não em prompt.

export async function getRecruiterConfig(
  supabase: SupabaseClient,
  unitId: string,
): Promise<AgentConfig | null> {
  const { data } = await supabase
    .from('agent_configs')
    .select('*')
    .eq('unit_id', unitId)
    .eq('agent_type', 'recruiter')
    .maybeSingle()

  return data as AgentConfig | null
}

/** Limites operacionais: defaults da spec sobrescritos por escalation_rules. */
export function getRecruiterLimits(config: AgentConfig): RecruiterLimits {
  const rules = (config.escalation_rules ?? {}) as Record<string, unknown>
  const num = (key: string, fallback: number) => {
    const value = Number(rules[key])
    return Number.isFinite(value) && value > 0 ? value : fallback
  }
  return {
    company_followup_max: num('company_followup_max', DEFAULT_RECRUITER_LIMITS.company_followup_max),
    candidate_attempts_max: num('candidate_attempts_max', DEFAULT_RECRUITER_LIMITS.candidate_attempts_max),
    screening_score_cutoff: num('screening_score_cutoff', DEFAULT_RECRUITER_LIMITS.screening_score_cutoff),
    sourcing_qualified_target: num('sourcing_qualified_target', DEFAULT_RECRUITER_LIMITS.sourcing_qualified_target),
    match_score_qualified: num('match_score_qualified', DEFAULT_RECRUITER_LIMITS.match_score_qualified),
    outreach_batch_size: num('outreach_batch_size', DEFAULT_RECRUITER_LIMITS.outreach_batch_size),
  }
}

/** Mensagens do Recruiter a candidatos enviadas hoje pela unidade. */
export async function countRecruiterSentToday(
  supabase: SupabaseClient,
  unitId: string,
): Promise<number> {
  const startOfDay = new Date()
  startOfDay.setHours(0, 0, 0, 0)

  const { count } = await supabase
    .from('candidate_messages')
    .select('id', { count: 'exact', head: true })
    .eq('unit_id', unitId)
    .eq('direction', 'outbound')
    .gte('sent_at', startOfDay.toISOString())

  return count ?? 0
}

/**
 * daily_limit é compartilhado por unidade entre SDR e Recruiter (§15):
 * soma conversations (SDR + intake empresa) e candidate_messages.
 */
export async function countUnitSentToday(
  supabase: SupabaseClient,
  unitId: string,
): Promise<number> {
  const [sdr, recruiter] = await Promise.all([
    countSentToday(supabase, unitId),
    countRecruiterSentToday(supabase, unitId),
  ])
  return sdr + recruiter
}

export type SendCheck = { ok: true } | { ok: false; reason: string }

/** Checagem única antes de qualquer envio: horário ativo + limite diário. */
export async function canSendNow(
  supabase: SupabaseClient,
  config: AgentConfig,
  unitId: string,
): Promise<SendCheck> {
  if (!isWithinActiveHours(config.active_hours)) {
    return { ok: false, reason: 'fora do horário ativo configurado' }
  }
  const sentToday = await countUnitSentToday(supabase, unitId)
  if (sentToday >= config.daily_limit) {
    return { ok: false, reason: `limite diário de ${config.daily_limit} mensagens atingido` }
  }
  return { ok: true }
}

/** LGPD (§18): nunca contatar candidato com opt-out ou consentimento revogado. */
export function canContactCandidate(candidate: Candidate): SendCheck {
  if (candidate.opted_out) return { ok: false, reason: 'candidato pediu para não ser contatado (opt-out)' }
  if (candidate.consent_status === 'revoked') {
    return { ok: false, reason: 'consentimento LGPD revogado na origem' }
  }
  return { ok: true }
}

// Filtro determinístico de promessa de contratação (§15.3): bloqueia a
// mensagem ANTES do envio se o texto gerado prometer vaga/contratação.
const PROMISE_PATTERNS: RegExp[] = [
  /voc[êe] (est[áa]|foi|ser[áa]) (contratad|aprovad|selecionad)/i,
  /a vaga (j[áa] )?[ée] (toda )?sua/i,
  /vaga garantida/i,
  /garant(o|imos|ia de) (a |sua |uma )?(vaga|contrata[çc][ãa]o|aprova[çc][ãa]o)/i,
  /pode considerar (a vaga|que foi|contratad)/i,
  /com certeza (voc[êe] )?(vai ser|ser[áa]) (contratad|aprovad|selecionad)/i,
]

export function containsHiringPromise(text: string): boolean {
  return PROMISE_PATTERNS.some((pattern) => pattern.test(text))
}

// Detecção determinística de opt-out (LGPD §18) — a IA também detecta,
// mas o padrão óbvio é resolvido em código, sem depender de prompt.
const OPT_OUT_PATTERNS: RegExp[] = [
  /n[ãa]o (quero|desejo) (mais )?(receber|ser contatad)/i,
  /para(r| de)? me (mandar|enviar) mensage/i,
  /me (tire|tirem|remova|removam|exclua|excluam) (da lista|do banco|dos contatos)/i,
  /descadastr/i,
  /\bopt.?out\b/i,
]

export function detectsOptOut(text: string): boolean {
  return OPT_OUT_PATTERNS.some((pattern) => pattern.test(text))
}

// Pedidos que a IA nunca resolve sozinha (§15.2, §17): negociação de
// bolsa/salário e afins escalam para humano.
const NEGOTIATION_PATTERNS: RegExp[] = [
  /(aumentar|negociar|melhorar|subir) (a |o )?(bolsa|sal[áa]rio|valor|remunera)/i,
  /(bolsa|sal[áa]rio|valor) [ée] negoci[áa]vel/i,
  /consegue (um valor|uma bolsa) (maior|melhor)/i,
]

export function detectsNegotiationRequest(text: string): boolean {
  return NEGOTIATION_PATTERNS.some((pattern) => pattern.test(text))
}
