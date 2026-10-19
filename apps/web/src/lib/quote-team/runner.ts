import { LEASE_SECONDS, MAX_ATTEMPTS, MAX_CONCURRENT_JOBS, QUOTE_STAGES, RETRY_BACKOFF_MS, RUNNER_TIME_BUDGET_MS, STAGE_TIMEOUT_MS, type QuoteStage } from './config'
import type { PendingItem } from './contracts'
import { BudgetGuard, committedUsd } from './budget'
import type { JobStore, QuoteJobRow } from './job-store'

export type StageContext = {
  job: QuoteJobRow
  /** Resultados já gravados das etapas anteriores (retomada: nada é refeito). */
  stepResults: Record<string, unknown>
  budget: BudgetGuard
}

export type StageOutcome =
  | { kind: 'done'; result: unknown; pending?: PendingItem[] }
  /** Falta informação crítica (foto, etiqueta, medida…): o job para e pede ao técnico. */
  | { kind: 'needs_input'; result?: unknown; pending: PendingItem[] }
  /** O orçamento acabou no meio da etapa: guarda o parcial e segue só com etapas sem IA. */
  | { kind: 'budget_exhausted'; result?: unknown; pending: PendingItem[] }

export type StageHandler = {
  /** Etapas sem IA (cálculo e auditoria por regras) continuam rodando mesmo com orçamento esgotado. */
  needsAi: boolean
  run: (ctx: StageContext) => Promise<StageOutcome>
}
export type StageHandlers = Partial<Record<QuoteStage, StageHandler>>

/** Erro que não adianta repetir (ex.: pipeline não implementado). */
export class NonRetryableError extends Error {
  constructor(message: string, public readonly code = 'non_retryable') {
    super(message)
    this.name = 'NonRetryableError'
  }
}

export function isPipelineReady(handlers: StageHandlers): boolean {
  return QUOTE_STAGES.every((stage) => Boolean(handlers[stage]))
}

export type RunOutcome =
  | { kind: 'not_claimed' }
  | { kind: 'yielded' | 'completed' | 'needs_input' | 'budget_exhausted' | 'failed' | 'retry_scheduled'; job: QuoteJobRow }

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout após ${ms} ms`)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

/** Chamado quando uma passada TERMINA o trabalho do job (concluído, esperando informação, sem orçamento ou falho). Nunca lança. */
export type RunnerHooks = {
  /** Cada chamada de IA liquidada (custo REAL): vira linha de uso da OpenAI por agente/cotação/empresa. Nunca lança. */
  onUsage?: (job: QuoteJobRow, e: { label: string; actualUsd: number; tokensIn: number; tokensOut: number }) => Promise<void>
  onFinish?: (job: QuoteJobRow, kind: 'completed' | 'needs_input' | 'budget_exhausted' | 'failed') => Promise<void>
}

export type RunnerDeps = {
  hooks?: RunnerHooks
  store: JobStore
  handlers: StageHandlers
  worker: string
  now?: () => number
  timeBudgetMs?: number
  stageTimeoutMs?: number
  leaseSeconds?: number
}

/**
 * Roda (ou retoma) UM job. Uma passada nunca passa de `timeBudgetMs`: ao estourar, devolve o job à fila com tudo
 * gravado e a próxima passada (tela ou cron por minuto) continua de onde parou. Etapas já concluídas nunca são refeitas.
 * Falhas: tentativas com espera crescente; esgotadas as tentativas o job fica 'failed' MANTENDO os resultados parciais
 * — a cotação manual continua disponível. Nada aqui bloqueia o salvamento da ordem.
 */
export async function runQuoteJob(deps: RunnerDeps, jobId: string | null): Promise<RunOutcome> {
  const now = deps.now ?? (() => Date.now())
  const timeBudget = deps.timeBudgetMs ?? RUNNER_TIME_BUDGET_MS
  const stageTimeout = deps.stageTimeoutMs ?? STAGE_TIMEOUT_MS
  const lease = deps.leaseSeconds ?? LEASE_SECONDS
  const startedAt = now()

  const job = jobId ? await deps.store.claim(jobId, deps.worker, lease) : await deps.store.claimNext(deps.worker, lease, MAX_CONCURRENT_JOBS)
  if (!job) return { kind: 'not_claimed' }

  const stepResults: Record<string, unknown> = { ...job.step_results }
  const pending: PendingItem[] = [...job.pending_items]
  let budgetExhausted = false
  const iso = (ms: number) => new Date(ms).toISOString()
  const reload = async () => (await deps.store.get(job.id)) as QuoteJobRow

  const release = { locked_by: null, locked_until: null }
  const finish = async (kind: 'completed' | 'needs_input' | 'budget_exhausted' | 'failed'): Promise<RunOutcome> => {
    const final = await reload()
    try {
      await deps.hooks?.onFinish?.(final, kind)
    } catch (error) {
      console.error(`[quote-team] gancho de término falhou (${kind}): ${error instanceof Error ? error.message : String(error)}`)
    }
    return { kind, job: final }
  }

  if (!isPipelineReady(deps.handlers)) {
    await deps.store.update(job.id, { status: 'failed', error_code: 'pipeline_not_ready', error_message: 'Pipeline de análise ainda não disponível.', finished_at: iso(now()), ...release })
    return finish('failed')
  }

  const budget = new BudgetGuard(deps.store, job.id, async (e) => {
    try {
      await deps.hooks?.onUsage?.(job, e)
    } catch {
      /* registro de uso nunca derruba a análise */
    }
  })

  for (const stage of QUOTE_STAGES) {
    if (stage in stepResults) continue

    if (now() - startedAt >= timeBudget) {
      await deps.store.update(job.id, { status: 'queued', next_run_at: iso(now()), step_results: stepResults, pending_items: pending, ...release })
      return { kind: 'yielded', job: await reload() }
    }

    const handler = deps.handlers[stage]!
    if (budgetExhausted && handler.needsAi) {
      pending.push({ code: 'budget_skipped', message_pt: `Etapa "${stage}" não executada: orçamento de IA da cotação esgotado. Complete manualmente.` })
      stepResults[stage] = { skipped: 'budget' }
      await deps.store.update(job.id, { stage, step_results: stepResults, pending_items: pending })
      continue
    }

    await deps.store.update(job.id, { stage })

    let outcome: StageOutcome
    try {
      outcome = await withTimeout(handler.run({ job: { ...job, stage }, stepResults, budget }), stageTimeout)
    } catch (error) {
      const attempts = (await reload()).attempt_count + 1
      const nonRetryable = error instanceof NonRetryableError
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 500)
      if (nonRetryable || attempts >= (job.max_attempts ?? MAX_ATTEMPTS)) {
        await deps.store.update(job.id, {
          status: 'failed', attempt_count: attempts, error_code: nonRetryable ? (error as NonRetryableError).code : 'stage_failed', error_message: message,
          step_results: stepResults, pending_items: pending, finished_at: iso(now()), ...release,
        })
        return finish('failed')
      }
      const wait = RETRY_BACKOFF_MS[Math.min(attempts - 1, RETRY_BACKOFF_MS.length - 1)]!
      await deps.store.update(job.id, {
        status: 'queued', attempt_count: attempts, error_code: 'stage_failed', error_message: message,
        next_run_at: iso(now() + wait), step_results: stepResults, pending_items: pending, ...release,
      })
      return { kind: 'retry_scheduled', job: await reload() }
    }

    stepResults[stage] = outcome.kind === 'done' ? outcome.result : (outcome.result ?? { partial: true })
    if ('pending' in outcome && outcome.pending) pending.push(...outcome.pending)
    await deps.store.update(job.id, { stage, step_results: stepResults, pending_items: pending })

    if (outcome.kind === 'needs_input') {
      await deps.store.update(job.id, { status: 'needs_input', finished_at: iso(now()), ...release })
      return finish('needs_input')
    }
    if (outcome.kind === 'budget_exhausted') budgetExhausted = true

    // Custo real passou do previsto (ex.: imagem maior que a estimada)? Para as etapas de IA agora — o teto manda.
    const snap = await deps.store.snapshot(job.id)
    if (snap && committedUsd(snap) >= snap.budget && !budgetExhausted) {
      budgetExhausted = true
      pending.push({ code: 'budget_reached', message_pt: 'Orçamento de IA da cotação atingido: as próximas etapas de IA não foram executadas. Complete manualmente o que faltar.' })
      await deps.store.update(job.id, { pending_items: pending })
    }
  }

  await deps.store.update(job.id, {
    status: budgetExhausted ? 'budget_exhausted' : 'completed',
    stage: 'done',
    step_results: stepResults,
    pending_items: pending,
    finished_at: iso(now()),
    ...release,
  })
  return finish(budgetExhausted ? 'budget_exhausted' : 'completed')
}
