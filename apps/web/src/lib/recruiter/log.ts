import type { SupabaseClient } from '@supabase/supabase-js'
import type { RecruiterDecisionType } from './types'

// Decision log + auditoria de processo do Recruiter (§5 e §6.5 da spec).
// recruiter_events registra O QUE aconteceu no processo; recruiter_decisions
// registra POR QUE o agente decidiu algo. Falha técnica continua indo para
// system_events (lib/system-events.ts). Nenhuma das duas funções lança —
// logging nunca derruba o fluxo principal.

export type RecruiterEventInput = {
  orgId?: string | null
  unitId?: string | null
  jobId?: string | null
  candidateId?: string | null
  eventType: string
  message?: string
  metadata?: Record<string, unknown>
}

export async function logRecruiterEvent(
  supabase: SupabaseClient,
  event: RecruiterEventInput,
): Promise<void> {
  try {
    const { error } = await supabase.from('recruiter_events').insert({
      org_id: event.orgId ?? null,
      unit_id: event.unitId ?? null,
      job_id: event.jobId ?? null,
      candidate_id: event.candidateId ?? null,
      event_type: event.eventType,
      message: event.message ?? null,
      metadata: event.metadata ?? {},
    })
    if (error) console.error(`[recruiter_event] falha ao gravar: ${error.message}`)
  } catch (err) {
    console.error(`[recruiter_event] ${err instanceof Error ? err.message : String(err)}`)
  }
}

export type RecruiterDecisionInput = {
  orgId?: string | null
  unitId?: string | null
  jobId?: string | null
  candidateId?: string | null
  decisionType: RecruiterDecisionType
  reasoning: string
  metadata?: Record<string, unknown>
}

export async function logDecision(
  supabase: SupabaseClient,
  decision: RecruiterDecisionInput,
): Promise<void> {
  try {
    const { error } = await supabase.from('recruiter_decisions').insert({
      org_id: decision.orgId ?? null,
      unit_id: decision.unitId ?? null,
      job_id: decision.jobId ?? null,
      candidate_id: decision.candidateId ?? null,
      decision_type: decision.decisionType,
      reasoning: decision.reasoning,
      metadata: decision.metadata ?? {},
    })
    if (error) console.error(`[recruiter_decision] falha ao gravar: ${error.message}`)
  } catch (err) {
    console.error(`[recruiter_decision] ${err instanceof Error ? err.message : String(err)}`)
  }
}
