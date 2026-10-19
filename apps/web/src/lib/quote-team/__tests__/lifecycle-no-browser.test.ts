import { describe, expect, it, vi } from 'vitest'
import { QUOTE_STAGES } from '../config'
import { enqueueQuoteJob } from '../jobs'
import { InMemoryJobStore } from '../job-store'
import { runQuoteJob, type StageHandlers } from '../runner'

/** O técnico salvou e FECHOU o app: ninguém chama a tela/rota de execução. Só o servidor (disparo imediato) e o cron por minuto trabalham. */
const input = { unit: { id: 'u', org_id: 'o', mode: 'shadow' as const }, appointmentId: 'a1', orderStatus: 'quote', notes: 'porta não fecha', mediaUrls: ['https://x/1.jpg'], trigger: 'save' as const }
const handlersFor = (calls: Record<string, number>, spend?: (jobId: string, store: InMemoryJobStore) => Promise<void>, store?: InMemoryJobStore): StageHandlers =>
  Object.fromEntries(
    QUOTE_STAGES.map((stage) => [
      stage,
      {
        needsAi: stage !== 'costing' && stage !== 'audit',
        run: async (ctx: { job: { id: string } }) => {
          calls[stage] = (calls[stage] ?? 0) + 1
          if (spend && store && stage === 'diagnosis') await spend(ctx.job.id, store)
          return { kind: 'done' as const, result: stage }
        },
      },
    ]),
  ) as StageHandlers

describe('processamento sem navegador (técnico fechou o app)', () => {
  it('enfileirado ao salvar e concluído só pelo cron (claimNext), sem nenhuma chamada da tela', async () => {
    const store = new InMemoryJobStore()
    const calls: Record<string, number> = {}
    const queued = await enqueueQuoteJob({ store, pipelineReady: true }, input)
    expect(queued.status).toBe('enqueued')
    const out = await runQuoteJob({ store, handlers: handlersFor(calls), worker: 'cron-1' }, null)
    expect(out.kind).toBe('completed')
    expect(Object.values(calls).every((n) => n === 1)).toBe(true)
  })

  it('função morreu no meio (lease vence): o cron seguinte retoma SEM refazer etapa concluída e sem cobrar de novo', async () => {
    let clock = 1_000_000
    const store = new InMemoryJobStore(() => clock)
    const calls: Record<string, number> = {}
    await enqueueQuoteJob({ store, pipelineReady: true }, input)
    const handlers = handlersFor(calls)
    // 1ª passada: diagnóstico grava resultado e gasta; "materials" morre junto com a função (nunca devolve)
    let boom = true
    handlers.materials = { needsAi: true, run: async (ctx) => { if (boom) { await ctx.budget.run({ label: 'm', worstCaseUsd: 0.2, call: () => new Promise(() => {}) }) } return { kind: 'done', result: 'materials' } } }
    const first = runQuoteJob({ store, handlers, worker: 'kick-1', stageTimeoutMs: 1_000_000 }, null)
    await vi.waitFor(async () => expect((await store.get('job-1'))!.reserved_usd).toBeGreaterThan(0))
    boom = false
    clock += 400_000 // lease de 300 s vence; a função original nunca volta
    const resumed = await runQuoteJob({ store, handlers, worker: 'cron-2' }, null)
    expect(resumed.kind).toBe('completed')
    expect(calls.diagnosis).toBe(1) // não refez a etapa já gravada
    const job = (await store.get('job-1'))!
    expect(job.reserved_usd).toBe(0)
    expect(job.unconfirmed_usd).toBeCloseTo(0.2) // a chamada interrompida fica "não confirmada": conta no teto, não vira gasto real nem é cobrada em dobro
    expect(job.spent_usd).toBe(0)
    void first
  })

  it('dois disparos ao mesmo tempo (disparo imediato + cron): só um processa, etapas rodam uma vez', async () => {
    const store = new InMemoryJobStore()
    const calls: Record<string, number> = {}
    await enqueueQuoteJob({ store, pipelineReady: true }, input)
    const handlers = handlersFor(calls)
    const [a, b] = await Promise.all([runQuoteJob({ store, handlers, worker: 'kick' }, 'job-1'), runQuoteJob({ store, handlers, worker: 'cron' }, null)])
    expect([a.kind, b.kind].sort()).toEqual(['completed', 'not_claimed'])
    expect(Object.values(calls).every((n) => n === 1)).toBe(true)
  })
})
