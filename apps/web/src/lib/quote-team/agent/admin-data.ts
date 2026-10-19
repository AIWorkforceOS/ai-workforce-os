import type { SupabaseClient } from '@supabase/supabase-js'
import { QUOTE_DEFAULT_MONTHLY_CAP_USD } from '../config'

/** Dados e métricas do painel "Super Agente — Piloto MAWI" (SOMENTE ADMIN: usa o service role depois de a rota/página verificar o administrador). */
type Row = Record<string, unknown>

export type PilotJob = { id: string; appointment_id: string; status: string; stage: string; rounds: number; spent_usd: number; reserved_usd: number; unconfirmed_usd: number; budget_usd: number; ai_calls: number; created_at: string; started_at: string | null; finished_at: string | null; error_code: string | null }
export type PilotDraft = { appointment_id: string; version: number; status: string; technical_check: string; pending_price_count: number; materials_total_micros: number | null; approved_at: string | null; created_at: string; edited_fields: string[] }
export type PilotReview = { appointment_id: string; diagnosis_verdict: 'correct' | 'partial' | 'incorrect' | null; materials_correct: number; materials_incorrect: number; hours_suggested: number | null; hours_final: number | null; manual_interventions: number }
export type PilotMessage = { appointment_id: string; role: string; kind: string }

export type PilotState = 'processing' | 'awaiting_info' | 'awaiting_approval' | 'approved' | 'failed' | 'budget_exhausted' | 'received'

/** Estado de negócio da cotação (o que o admin quer ver), a partir do job e da versão mais recente. */
export function pilotStateOf(job: PilotJob, latest: PilotDraft | null): PilotState {
  if (job.status === 'queued' || job.status === 'running') return 'processing'
  if (job.status === 'needs_input') return 'awaiting_info'
  if (latest?.status === 'approved') return 'approved'
  if (job.status === 'failed' || job.status === 'cancelled') return 'failed'
  if (job.status === 'budget_exhausted') return latest ? 'awaiting_approval' : 'budget_exhausted'
  if (job.status === 'completed') return latest ? 'awaiting_approval' : 'received'
  return 'received'
}

const committed = (j: PilotJob) => Number(j.spent_usd) + Number(j.reserved_usd) + Number(j.unconfirmed_usd)
const avg = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null)

export type PilotSummary = {
  total: number
  byState: Record<PilotState, number>
  avgProcessingSeconds: number | null
  verdicts: { correct: number; partial: number; incorrect: number; pending: number }
  materialsCorrect: number
  materialsIncorrect: number
  pendingPriceItems: number
  questionsPerQuote: number | null
  totalCostUsd: number
  avgCostUsd: number | null
  maxCostUsd: number | null
  revisions: number
  hoursSuggestedVsFinal: { quotes: number; avgDeltaHours: number | null }
  alerts: string[]
}

export function summarizePilot(input: { jobs: PilotJob[]; drafts: PilotDraft[]; reviews: PilotReview[]; messages: PilotMessage[]; monthSpentUsd: number; monthlyCapUsd: number }): PilotSummary {
  const latestByAppt = new Map<string, PilotDraft>()
  for (const d of input.drafts) {
    const cur = latestByAppt.get(d.appointment_id)
    if (!cur || d.version > cur.version) latestByAppt.set(d.appointment_id, d)
  }
  const byState: Record<PilotState, number> = { processing: 0, awaiting_info: 0, awaiting_approval: 0, approved: 0, failed: 0, budget_exhausted: 0, received: 0 }
  for (const j of input.jobs) byState[pilotStateOf(j, latestByAppt.get(j.appointment_id) ?? null)] += 1

  const durations = input.jobs.filter((j) => (j.status === 'completed' || j.status === 'budget_exhausted') && j.finished_at).map((j) => (Date.parse(j.finished_at as string) - Date.parse(j.created_at)) / 1000)
  const reviewByAppt = new Map(input.reviews.map((r) => [r.appointment_id, r]))
  const reviewed = input.jobs.filter((j) => reviewByAppt.has(j.appointment_id))
  const verdicts = { correct: 0, partial: 0, incorrect: 0, pending: 0 }
  for (const j of input.jobs) {
    const v = reviewByAppt.get(j.appointment_id)?.diagnosis_verdict
    if (v) verdicts[v] += 1
    else if (pilotStateOf(j, latestByAppt.get(j.appointment_id) ?? null) === 'approved') verdicts.pending += 1
  }
  const costs = input.jobs.map(committed)
  const questions = input.messages.filter((m) => m.role === 'agent' && m.kind === 'question').length
  const deltas = input.reviews.filter((r) => r.hours_suggested != null && r.hours_final != null).map((r) => Number(r.hours_final) - Number(r.hours_suggested))
  const alerts: string[] = []
  if (input.monthlyCapUsd > 0 && input.monthSpentUsd >= input.monthlyCapUsd * 0.8) alerts.push(`Consumo do mês em ${((input.monthSpentUsd / input.monthlyCapUsd) * 100).toFixed(0)}% do limite (US$ ${input.monthSpentUsd.toFixed(2)} de US$ ${input.monthlyCapUsd.toFixed(2)}).`)
  const nearCap = input.jobs.filter((j) => Number(j.budget_usd) > 0 && committed(j) >= Number(j.budget_usd) * 0.8).length
  if (nearCap > 0) alerts.push(`${nearCap} cotação(ões) usaram 80% ou mais do teto de IA por cotação.`)
  if (byState.failed > 0) alerts.push(`${byState.failed} cotação(ões) com falha — o técnico pode tentar de novo.`)
  const unconfirmed = input.jobs.reduce((n, j) => n + Number(j.unconfirmed_usd), 0)
  if (unconfirmed > 0) alerts.push(`US$ ${unconfirmed.toFixed(2)} em reservas "não confirmadas" (chamadas interrompidas): reconcilie com o custo real da OpenAI.`)

  return {
    total: input.jobs.length,
    byState,
    avgProcessingSeconds: avg(durations),
    verdicts,
    materialsCorrect: reviewed.reduce((n, j) => n + (reviewByAppt.get(j.appointment_id)?.materials_correct ?? 0), 0),
    materialsIncorrect: reviewed.reduce((n, j) => n + (reviewByAppt.get(j.appointment_id)?.materials_incorrect ?? 0), 0),
    pendingPriceItems: [...latestByAppt.values()].reduce((n, d) => n + (d.status === 'draft' ? Number(d.pending_price_count) : 0), 0),
    questionsPerQuote: input.jobs.length ? questions / input.jobs.length : null,
    totalCostUsd: costs.reduce((a, b) => a + b, 0),
    avgCostUsd: avg(costs),
    maxCostUsd: costs.length ? Math.max(...costs) : null,
    revisions: input.jobs.reduce((n, j) => n + Math.max(0, Number(j.rounds) - 1), 0),
    hoursSuggestedVsFinal: { quotes: deltas.length, avgDeltaHours: avg(deltas) },
    alerts,
  }
}

const num = (v: unknown) => Number(v ?? 0)

export async function loadPilotOverview(db: SupabaseClient, unit: { id: string; org_id: string }) {
  const [jobsRes, draftsRes, reviewsRes, messagesRes, limitRes, reportRes] = await Promise.all([
    db.from('quote_analysis_jobs').select('id, appointment_id, status, stage, rounds, spent_usd, reserved_usd, unconfirmed_usd, budget_usd, ai_calls, created_at, started_at, finished_at, error_code').eq('unit_id', unit.id).order('created_at', { ascending: false }),
    db.from('quote_drafts').select('appointment_id, version, status, technical_check, pending_price_count, materials_total_micros, approved_at, created_at, edited_fields').eq('unit_id', unit.id),
    db.from('quote_pilot_reviews').select('appointment_id, diagnosis_verdict, materials_correct, materials_incorrect, hours_suggested, hours_final, manual_interventions').eq('unit_id', unit.id),
    db.from('quote_messages').select('appointment_id, role, kind').eq('unit_id', unit.id),
    db.from('quote_org_limits').select('monthly_cap_usd').eq('org_id', unit.org_id).maybeSingle(),
    db.rpc('quote_org_budget_report', { p_org: unit.org_id }),
  ])
  const jobs = ((jobsRes.data as Row[] | null) ?? []).map((j) => ({ ...j, spent_usd: num(j.spent_usd), reserved_usd: num(j.reserved_usd), unconfirmed_usd: num(j.unconfirmed_usd), budget_usd: num(j.budget_usd), rounds: num(j.rounds), ai_calls: num(j.ai_calls) })) as unknown as PilotJob[]
  const drafts = ((draftsRes.data as Row[] | null) ?? []) as unknown as PilotDraft[]
  const reviews = ((reviewsRes.data as Row[] | null) ?? []) as unknown as PilotReview[]
  const messages = ((messagesRes.data as Row[] | null) ?? []) as unknown as PilotMessage[]
  const cap = num((limitRes.data as Row | null)?.monthly_cap_usd ?? QUOTE_DEFAULT_MONTHLY_CAP_USD)
  const report = ((reportRes.data as Row[] | null) ?? [])[0] ?? null
  const month = { confirmed: num(report?.confirmed_usd), active: num(report?.active_usd), unconfirmed: num(report?.unconfirmed_usd), total: num(report?.total_usd), overrun: num(report?.overrun_usd), cap }
  const summary = summarizePilot({ jobs, drafts, reviews, messages, monthSpentUsd: month.total, monthlyCapUsd: cap })

  const apptIds = [...new Set(jobs.map((j) => j.appointment_id))]
  const { data: apptRows } = apptIds.length ? await db.from('appointments').select('id, service_order_number, service_order_location_name, employee_id, starts_at').in('id', apptIds) : { data: [] }
  const { data: empRows } = await db.from('employees').select('id, name, quote_agent_enabled, is_active').eq('unit_id', unit.id)
  return { jobs, drafts, reviews, messages, summary, month, appointments: (apptRows as Row[] | null) ?? [], employees: (empRows as Row[] | null) ?? [] }
}

/** Técnicos que o admin pode (des)habilitar no piloto: só ATIVOS. Um desativado que ainda esteja marcado aparece apenas para poder ser desmarcado. */
export function pilotEligibleEmployees(rows: Record<string, unknown>[]): { id: string; name: string; enabled: boolean }[] {
  return rows
    .filter((e) => e.is_active !== false || Boolean(e.quote_agent_enabled))
    .map((e) => ({ id: String(e.id), name: String(e.name).trim(), enabled: Boolean(e.quote_agent_enabled) }))
}
