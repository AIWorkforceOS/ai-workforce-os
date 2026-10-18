import type { SupabaseClient } from '@supabase/supabase-js'
import type { JobStatus, PendingItem } from './contracts'
import type { QuoteStage } from './config'
import type { BudgetSnapshot, BudgetStore } from './budget'

export type QuoteJobRow = {
  id: string
  org_id: string
  unit_id: string
  appointment_id: string
  status: JobStatus
  stage: QuoteStage | 'queued' | 'done'
  trigger_source: 'save' | 'manual' | 'reanalyze'
  mode: 'shadow' | 'live'
  parent_job_id: string | null
  idempotency_key: string
  input_snapshot: Record<string, unknown>
  photo_count: number
  photo_exception_reason: string | null
  attempt_count: number
  max_attempts: number
  next_run_at: string
  locked_by: string | null
  locked_until: string | null
  budget_usd: number
  spent_usd: number
  reserved_usd: number
  unconfirmed_usd: number
  ai_calls: number
  tokens_in: number
  tokens_out: number
  pending_items: PendingItem[]
  step_results: Record<string, unknown>
  error_code: string | null
  error_message: string | null
  created_by: string | null
  created_at: string
  started_at: string | null
  finished_at: string | null
  updated_at: string
}

export type NewQuoteJob = Pick<QuoteJobRow, 'org_id' | 'unit_id' | 'appointment_id' | 'idempotency_key' | 'trigger_source' | 'mode' | 'input_snapshot' | 'photo_count' | 'photo_exception_reason' | 'budget_usd' | 'created_by'> & { parent_job_id?: string | null }

export type JobPatch = Partial<Pick<QuoteJobRow, 'status' | 'stage' | 'attempt_count' | 'next_run_at' | 'locked_by' | 'locked_until' | 'pending_items' | 'step_results' | 'error_code' | 'error_message' | 'finished_at'>>

export interface JobStore extends BudgetStore {
  get(jobId: string): Promise<QuoteJobRow | null>
  findByIdempotencyKey(key: string): Promise<QuoteJobRow | null>
  /** Quantos jobs a ordem abriu desde `sinceMs` (trava de reanálise em loop). */
  countForAppointmentSince(appointmentId: string, sinceMs: number): Promise<number>
  /** Reservas presas (job terminado/sem worker há muito) viram NÃO CONFIRMADAS (contam nos tetos, mas não são gasto real). Devolve quantos jobs ajustou. */
  reconcileBudgets(staleMinutes?: number): Promise<number>
  /** Troca o pior caso preventivo de uma reserva "não confirmada" pelo custo REAL (pode ser 0). Idempotente. */
  reconcileReservation(reservationId: string, actualUsd: number, note?: string): Promise<boolean>
  /** Cria o job; se a chave de idempotência já existe, devolve o existente (created=false) — nunca duplica. */
  insert(job: NewQuoteJob): Promise<{ job: QuoteJobRow; created: boolean }>
  claim(jobId: string, worker: string, leaseSeconds: number): Promise<QuoteJobRow | null>
  claimNext(worker: string, leaseSeconds: number, maxConcurrent?: number): Promise<QuoteJobRow | null>
  update(jobId: string, patch: JobPatch): Promise<void>
}

/** Implementação real (service role): usa as funções atômicas das migrations 094/095. */
export class SupabaseJobStore implements JobStore {
  constructor(private readonly db: SupabaseClient) {}

  async get(jobId: string) {
    const { data } = await this.db.from('quote_analysis_jobs').select('*').eq('id', jobId).maybeSingle()
    return (data as QuoteJobRow | null) ?? null
  }

  async findByIdempotencyKey(key: string) {
    const { data } = await this.db.from('quote_analysis_jobs').select('*').eq('idempotency_key', key).maybeSingle()
    return (data as QuoteJobRow | null) ?? null
  }

  async countForAppointmentSince(appointmentId: string, sinceMs: number) {
    const { count } = await this.db.from('quote_analysis_jobs').select('id', { count: 'exact', head: true }).eq('appointment_id', appointmentId).gte('created_at', new Date(sinceMs).toISOString())
    return count ?? 0
  }

  async reconcileBudgets(staleMinutes = 10) {
    const { data } = await this.db.rpc('reconcile_quote_budgets', { p_stale_minutes: staleMinutes })
    return typeof data === 'number' ? data : 0
  }

  async reconcileReservation(reservationId: string, actualUsd: number, note?: string) {
    const { data, error } = await this.db.rpc('reconcile_quote_reservation', { p_reservation_id: reservationId, p_actual: actualUsd, p_note: note ?? null })
    if (error) throw new Error(error.message)
    return data === true
  }

  async insert(job: NewQuoteJob) {
    const { data, error } = await this.db.from('quote_analysis_jobs').insert({ ...job, parent_job_id: job.parent_job_id ?? null }).select('*').single()
    if (!error && data) return { job: data as QuoteJobRow, created: true }
    // 23505 = chave de idempotência já existe → devolve o existente
    const { data: existing } = await this.db.from('quote_analysis_jobs').select('*').eq('idempotency_key', job.idempotency_key).maybeSingle()
    if (existing) return { job: existing as QuoteJobRow, created: false }
    throw new Error(error?.message ?? 'Não foi possível criar o job de análise.')
  }

  async claim(jobId: string, worker: string, leaseSeconds: number) {
    const { data } = await this.db.rpc('claim_quote_job', { p_job_id: jobId, p_worker: worker, p_lease_seconds: leaseSeconds })
    return ((data as QuoteJobRow[] | null) ?? [])[0] ?? null
  }

  async claimNext(worker: string, leaseSeconds: number, maxConcurrent = 3) {
    const { data } = await this.db.rpc('claim_next_quote_job', { p_worker: worker, p_lease_seconds: leaseSeconds, p_max_concurrent: maxConcurrent })
    return ((data as QuoteJobRow[] | null) ?? [])[0] ?? null
  }

  async update(jobId: string, patch: JobPatch) {
    await this.db.from('quote_analysis_jobs').update(patch).eq('id', jobId)
  }

  async reserve(jobId: string, usd: number) {
    const { data, error } = await this.db.rpc('reserve_quote_budget', { p_job_id: jobId, p_amount: usd })
    // erro de infraestrutura = NÃO reserva (nunca gasta sem reserva)
    if (error) return null
    return typeof data === 'string' ? data : null
  }

  async settle(reservationId: string, actualUsd: number, tokensIn: number, tokensOut: number) {
    const { data, error } = await this.db.rpc('settle_quote_budget', { p_reservation_id: reservationId, p_actual: actualUsd, p_tokens_in: tokensIn, p_tokens_out: tokensOut })
    if (error) throw new Error(error.message)
    return data === true
  }

  async release(reservationId: string, note?: string) {
    const { data, error } = await this.db.rpc('release_quote_budget', { p_reservation_id: reservationId, p_note: note ?? null })
    if (error) throw new Error(error.message)
    return data === true
  }

  async markUnconfirmed(reservationId: string, note?: string) {
    const { data, error } = await this.db.rpc('mark_quote_reservation_unconfirmed', { p_reservation_id: reservationId, p_note: note ?? null })
    if (error) throw new Error(error.message)
    return data === true
  }

  async snapshot(jobId: string): Promise<BudgetSnapshot | null> {
    const row = await this.get(jobId)
    return row ? { budget: Number(row.budget_usd), spent: Number(row.spent_usd), reserved: Number(row.reserved_usd), unconfirmed: Number(row.unconfirmed_usd ?? 0) } : null
  }
}

type Reservation = { id: string; job_id: string; org_id: string; amount_usd: number; status: 'reserved' | 'settled' | 'released' | 'unconfirmed' | 'reconciled'; actual_usd: number | null; overrun_usd: number; note: string | null; created_ms: number }

/** Implementação em memória com a MESMA semântica (lease, idempotência, tetos) — usada nos testes. */
export class InMemoryJobStore implements JobStore {
  jobs = new Map<string, QuoteJobRow>()
  /** Razão de reservas (espelha quote_budget_reservations). */
  reservations = new Map<string, Reservation>()
  private resSeq = 0
  private seq = 0
  constructor(public now: () => number = () => Date.now(), public monthlyCapUsd = 50) {}

  private iso(ms: number) {
    return new Date(ms).toISOString()
  }

  async get(jobId: string) {
    const job = this.jobs.get(jobId)
    return job ? { ...job } : null
  }

  async findByIdempotencyKey(key: string) {
    const job = [...this.jobs.values()].find((j) => j.idempotency_key === key)
    return job ? { ...job } : null
  }

  async countForAppointmentSince(appointmentId: string, sinceMs: number) {
    return [...this.jobs.values()].filter((j) => j.appointment_id === appointmentId && Date.parse(j.created_at) >= sinceMs).length
  }

  /** Reservas ativas do job viram "não confirmadas" (pior caso continua contando, mas NÃO é gasto real). */
  private expireReservations(job: QuoteJobRow) {
    for (const r of this.reservations.values()) {
      if (r.job_id === job.id && r.status === 'reserved') {
        r.status = 'unconfirmed'
        job.reserved_usd = Math.max(job.reserved_usd - r.amount_usd, 0)
        job.unconfirmed_usd += r.amount_usd
      }
    }
  }

  async reconcileBudgets(staleMinutes = 10) {
    let n = 0
    for (const job of this.jobs.values()) {
      const noWorker = job.status !== 'running' || !job.locked_until || Date.parse(job.locked_until) < this.now()
      const stale = [...this.reservations.values()].some((r) => r.job_id === job.id && r.status === 'reserved' && this.now() - r.created_ms > staleMinutes * 60_000)
      if (stale && noWorker) {
        this.expireReservations(job)
        n += 1
      }
    }
    return n
  }

  async reconcileReservation(reservationId: string, actualUsd: number, note?: string) {
    const r = this.reservations.get(reservationId)
    const job = r && this.jobs.get(r.job_id)
    if (!r || !job || r.status !== 'unconfirmed') return false
    const actual = Math.max(actualUsd, 0)
    job.unconfirmed_usd = Math.max(job.unconfirmed_usd - r.amount_usd, 0)
    job.spent_usd += actual
    Object.assign(r, { status: 'reconciled' as const, actual_usd: actual, overrun_usd: Math.max(actual - r.amount_usd, 0), note: note ?? r.note })
    return true
  }

  async insert(job: NewQuoteJob) {
    const existing = [...this.jobs.values()].find((j) => j.idempotency_key === job.idempotency_key)
    if (existing) return { job: { ...existing }, created: false }
    const id = `job-${++this.seq}`
    const row: QuoteJobRow = {
      id, ...job, parent_job_id: job.parent_job_id ?? null,
      status: 'queued', stage: 'queued', attempt_count: 0, max_attempts: 3, next_run_at: this.iso(this.now()), locked_by: null, locked_until: null,
      spent_usd: 0, reserved_usd: 0, unconfirmed_usd: 0, ai_calls: 0, tokens_in: 0, tokens_out: 0, pending_items: [], step_results: {}, error_code: null, error_message: null,
      created_at: this.iso(this.now()), started_at: null, finished_at: null, updated_at: this.iso(this.now()),
    }
    this.jobs.set(id, row)
    return { job: { ...row }, created: true }
  }

  private lockable(job: QuoteJobRow) {
    return (job.status === 'queued' || job.status === 'running') && (!job.locked_until || Date.parse(job.locked_until) < this.now())
  }

  private take(job: QuoteJobRow, worker: string, leaseSeconds: number) {
    // reserva que ficou presa (chamada que morreu) vira NÃO CONFIRMADA: continua contando nos tetos, sem virar gasto real
    this.expireReservations(job)
    job.status = 'running'
    job.locked_by = worker
    job.locked_until = this.iso(this.now() + leaseSeconds * 1000)
    job.started_at = job.started_at ?? this.iso(this.now())
    return { ...job }
  }

  async claim(jobId: string, worker: string, leaseSeconds: number) {
    const job = this.jobs.get(jobId)
    return job && this.lockable(job) ? this.take(job, worker, leaseSeconds) : null
  }

  async claimNext(worker: string, leaseSeconds: number, maxConcurrent = 3) {
    const running = [...this.jobs.values()].filter((j) => j.status === 'running' && j.locked_until && Date.parse(j.locked_until) > this.now()).length
    if (running >= maxConcurrent) return null
    const next = [...this.jobs.values()].filter((j) => this.lockable(j) && Date.parse(j.next_run_at) <= this.now()).sort((a, b) => Date.parse(a.next_run_at) - Date.parse(b.next_run_at))[0]
    return next ? this.take(next, worker, leaseSeconds) : null
  }

  async update(jobId: string, patch: JobPatch) {
    const job = this.jobs.get(jobId)
    if (job) Object.assign(job, patch, { updated_at: this.iso(this.now()) })
  }

  /** Mês da empresa a partir do razão: confirmado + ativo + não confirmado. */
  private monthSpend(orgId: string) {
    let total = 0
    for (const r of this.reservations.values()) {
      if (r.org_id !== orgId) continue
      total += r.status === 'reserved' || r.status === 'unconfirmed' ? r.amount_usd : r.status === 'released' ? 0 : (r.actual_usd ?? 0)
    }
    return total
  }

  async reserve(jobId: string, usd: number) {
    const job = this.jobs.get(jobId)
    if (!job || usd < 0 || job.status !== 'running') return null
    if (job.spent_usd + job.reserved_usd + job.unconfirmed_usd + usd > job.budget_usd + 1e-9) return null
    if (this.monthSpend(job.org_id) + usd > this.monthlyCapUsd + 1e-9) return null
    const id = `res-${++this.resSeq}`
    this.reservations.set(id, { id, job_id: jobId, org_id: job.org_id, amount_usd: usd, status: 'reserved', actual_usd: null, overrun_usd: 0, note: null, created_ms: this.now() })
    job.reserved_usd += usd
    return id
  }

  /** Idempotente: reserva já liquidada/liberada/reconciliada não é cobrada de novo. */
  async settle(reservationId: string, actualUsd: number, tokensIn: number, tokensOut: number) {
    const r = this.reservations.get(reservationId)
    const job = r && this.jobs.get(r.job_id)
    if (!r || !job || (r.status !== 'reserved' && r.status !== 'unconfirmed')) return false
    const actual = Math.max(actualUsd, 0)
    if (r.status === 'reserved') job.reserved_usd = Math.max(job.reserved_usd - r.amount_usd, 0)
    else job.unconfirmed_usd = Math.max(job.unconfirmed_usd - r.amount_usd, 0)
    job.spent_usd += actual
    job.ai_calls += 1
    job.tokens_in += tokensIn
    job.tokens_out += tokensOut
    Object.assign(r, { status: 'settled' as const, actual_usd: actual, overrun_usd: Math.max(actual - r.amount_usd, 0) })
    return true
  }

  async release(reservationId: string, note?: string) {
    const r = this.reservations.get(reservationId)
    const job = r && this.jobs.get(r.job_id)
    if (!r || !job || r.status !== 'reserved') return false
    job.reserved_usd = Math.max(job.reserved_usd - r.amount_usd, 0)
    Object.assign(r, { status: 'released' as const, actual_usd: 0, note: note ?? r.note })
    return true
  }

  async markUnconfirmed(reservationId: string, note?: string) {
    const r = this.reservations.get(reservationId)
    const job = r && this.jobs.get(r.job_id)
    if (!r || !job || r.status !== 'reserved') return false
    job.reserved_usd = Math.max(job.reserved_usd - r.amount_usd, 0)
    job.unconfirmed_usd += r.amount_usd
    Object.assign(r, { status: 'unconfirmed' as const, note: note ?? r.note })
    return true
  }

  async snapshot(jobId: string) {
    const job = this.jobs.get(jobId)
    return job ? { budget: job.budget_usd, spent: job.spent_usd, reserved: job.reserved_usd, unconfirmed: job.unconfirmed_usd } : null
  }
}
