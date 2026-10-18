import { describe, expect, it, vi } from 'vitest'
import { BudgetGuard } from '../budget'
import { enqueueQuoteJob } from '../jobs'
import { InMemoryJobStore, type NewQuoteJob } from '../job-store'
import { QUOTE_STAGES } from '../config'
import { runQuoteJob, type StageHandlers } from '../runner'

const newJob = (over: Partial<NewQuoteJob> = {}): NewQuoteJob => ({
  org_id: 'org-1', unit_id: 'u', appointment_id: 'a', idempotency_key: 'k' + Math.random(), trigger_source: 'save', mode: 'shadow',
  input_snapshot: {}, photo_count: 5, photo_exception_reason: null, budget_usd: 0.6, created_by: null, ...over,
})
const running = async (store: InMemoryJobStore, over: Partial<NewQuoteJob> = {}) => {
  const { job } = await store.insert(newJob(over))
  await store.claim(job.id, 'w', 300)
  return job.id
}

describe('teto de US$ 0,60 — chamadas SIMULTÂNEAS', () => {
  it('várias reservas ao mesmo tempo no mesmo job: a soma nunca passa do teto', async () => {
    const store = new InMemoryJobStore()
    const id = await running(store)
    const results = await Promise.all(Array.from({ length: 10 }, () => store.reserve(id, 0.1)))
    expect(results.filter(Boolean)).toHaveLength(6)
    expect((await store.get(id))!.reserved_usd).toBeCloseTo(0.6, 6)
  })
  it('jobs diferentes da MESMA empresa em paralelo respeitam o teto mensal', async () => {
    const store = new InMemoryJobStore(() => Date.now(), 0.5)
    const ids = await Promise.all([running(store), running(store), running(store)])
    const results = await Promise.all(ids.map((id) => store.reserve(id, 0.2)))
    expect(results.filter(Boolean)).toHaveLength(2)
  })
  it('job que não está rodando (parado, terminado) não consegue reservar', async () => {
    const store = new InMemoryJobStore()
    const { job } = await store.insert(newJob())
    expect(await store.reserve(job.id, 0.05)).toBe(false)
  })
})

describe('FALHAS, TIMEOUTS e reservas não liberadas', () => {
  it('chamada que lança erro devolve a reserva imediatamente', async () => {
    const store = new InMemoryJobStore()
    const id = await running(store)
    await new BudgetGuard(store, id).run({ label: 'x', worstCaseUsd: 0.3, call: async () => { throw new Error('503') } })
    expect((await store.get(id))!.reserved_usd).toBe(0)
  })
  it('worker morreu com reserva aberta: o próximo claim COBRA a reserva como gasto (teto nunca é furado)', async () => {
    let clock = 1_000_000
    const store = new InMemoryJobStore(() => clock)
    const id = await running(store)
    expect(await store.reserve(id, 0.4)).toBe(true) // chamada em andamento... e o processo morre aqui
    clock += 400_000 // lease vence
    const reclaimed = await store.claim(id, 'w2', 300)
    expect(reclaimed!.reserved_usd).toBe(0)
    expect(reclaimed!.spent_usd).toBeCloseTo(0.4)
    // só sobra 0,20 para gastar: o teto continua valendo
    expect(await store.reserve(id, 0.3)).toBe(false)
    expect(await store.reserve(id, 0.19)).toBe(true)
  })
  it('reconciliação: reserva presa em job terminado há muito vira gasto (não vaza do mês)', async () => {
    let clock = 1_000_000
    const store = new InMemoryJobStore(() => clock)
    const id = await running(store)
    await store.reserve(id, 0.25)
    await store.update(id, { status: 'failed', locked_by: null, locked_until: null })
    expect(await store.reconcileBudgets(10)).toBe(0) // recente: ainda pode ser uma chamada em curso
    clock += 11 * 60_000
    expect(await store.reconcileBudgets(10)).toBe(1)
    const row = (await store.get(id))!
    expect(row.reserved_usd).toBe(0)
    expect(row.spent_usd).toBeCloseTo(0.25)
  })
  it('chamada que passou do pior caso estimado: o runner PARA as etapas de IA e lista o pendente', async () => {
    const store = new InMemoryJobStore()
    const { job } = await store.insert(newJob())
    const aiAfter = vi.fn()
    const handlers = Object.fromEntries(QUOTE_STAGES.map((s) => [s, { needsAi: s !== 'costing' && s !== 'audit', run: async () => ({ kind: 'done' as const, result: s }) }])) as StageHandlers
    handlers.diagnosis = { needsAi: true, run: async () => { store.jobs.get(job.id)!.spent_usd = 0.61; return { kind: 'done', result: 'estourou' } } }
    handlers.materials = { needsAi: true, run: aiAfter }
    const out = await runQuoteJob({ store, handlers, worker: 'w' }, job.id)
    expect(out.kind).toBe('budget_exhausted')
    expect(aiAfter).not.toHaveBeenCalled()
    const row = (await store.get(job.id))!
    expect(row.pending_items.map((p) => p.code)).toContain('budget_reached')
    expect(row.step_results.costing).toBeDefined()
  })
})

describe('limites de concorrência e de reanálise', () => {
  it('no máximo 3 jobs rodando ao mesmo tempo (cron sobreposto não multiplica gasto)', async () => {
    const store = new InMemoryJobStore()
    for (let i = 0; i < 5; i++) await store.insert(newJob())
    const claimed = []
    for (let i = 0; i < 5; i++) {
      const j = await store.claimNext('w' + i, 300, 3)
      if (j) claimed.push(j)
    }
    expect(claimed).toHaveLength(3)
  })
  it('reanálise em loop: a partir da 4ª análise nova no dia a ordem é barrada', async () => {
    const store = new InMemoryJobStore()
    const unit = { id: 'u', org_id: 'o', mode: 'shadow' as const }
    const base = { unit, appointmentId: 'a1', orderStatus: 'quote', notes: 'n', mediaUrls: ['x'] }
    const out = []
    for (let i = 0; i < 5; i++) out.push(await enqueueQuoteJob({ store, pipelineReady: true }, { ...base, trigger: 'reanalyze', nonce: `n${i}` }))
    expect(out.map((o) => o.status)).toEqual(['enqueued', 'enqueued', 'enqueued', 'skipped', 'skipped'])
    // e reenviar a MESMA entrada continua devolvendo o job existente (sem gastar nem ser barrado)
    expect((await enqueueQuoteJob({ store, pipelineReady: true }, { ...base, trigger: 'reanalyze', nonce: 'n0' })).status).toBe('existing')
  })
})
