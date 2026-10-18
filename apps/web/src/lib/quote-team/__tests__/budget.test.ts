import { describe, expect, it, vi } from 'vitest'
import { BudgetGuard, costUsd, markNotCharged, worstCaseUsd, WEB_SEARCH_CALL_USD } from '../budget'
import { InMemoryJobStore, type NewQuoteJob } from '../job-store'

/** Só job em EXECUÇÃO (com lease) pode reservar orçamento — igual ao banco. */
async function running(store: InMemoryJobStore, over: Partial<NewQuoteJob> = {}) {
  const { job } = await store.insert(newJob(over))
  await store.claim(job.id, 'w', 300)
  return job
}

const newJob = (over: Partial<NewQuoteJob> = {}): NewQuoteJob => ({
  org_id: 'org-1', unit_id: 'u', appointment_id: 'a', idempotency_key: 'k' + Math.random(), trigger_source: 'save', mode: 'shadow',
  input_snapshot: {}, photo_count: 0, photo_exception_reason: null, budget_usd: 0.6, created_by: null, ...over,
})

describe('custo por modelo', () => {
  it('calcula pela tabela oficial; modelo desconhecido nunca é chutado', () => {
    expect(costUsd({ model: 'gpt-6-luna', inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBeCloseTo(0.6, 6)
    expect(costUsd({ model: 'modelo-inexistente', inputTokens: 1, outputTokens: 1 })).toBe(Number.POSITIVE_INFINITY)
  })
  it('busca: US$ 0,01 por chamada + tokens recuperados', () => {
    const c = costUsd({ model: 'gpt-6-luna', inputTokens: 0, outputTokens: 0, webSearchCalls: 10, searchContentTokens: 100_000 })
    expect(c).toBeCloseTo(10 * WEB_SEARCH_CALL_USD + 0.01, 6)
  })
  it('pior caso usa a saída máxima e o limite de conteúdo recuperado', () => {
    expect(worstCaseUsd({ model: 'gpt-6.1-sol', inputTokens: 9000, maxOutputTokens: 3000, webSearchCalls: 0 })).toBeCloseTo((9000 * 2 + 3000 * 10) / 1e6, 8)
  })
})

describe('BudgetGuard — reservar antes de gastar', () => {
  it('chamada que cabe: reserva, executa, liquida com o custo REAL e devolve o resto', async () => {
    const store = new InMemoryJobStore()
    const job = await running(store)
    const guard = new BudgetGuard(store, job.id)
    const out = await guard.run({ label: 'diag', worstCaseUsd: 0.2, call: async () => ({ result: 'ok', actualUsd: 0.05, tokensIn: 100, tokensOut: 50 }) })
    expect(out.ok).toBe(true)
    const row = (await store.get(job.id))!
    expect(row.reserved_usd).toBe(0)
    expect(row.spent_usd).toBeCloseTo(0.05)
    expect(row.ai_calls).toBe(1)
  })

  it('NÃO inicia a chamada se o pior caso estourar o teto da cotação (US$ 0,60)', async () => {
    const store = new InMemoryJobStore()
    const job = await running(store)
    const guard = new BudgetGuard(store, job.id)
    const call = vi.fn()
    await guard.run({ label: 'a', worstCaseUsd: 0.4, call: async () => ({ result: 1, actualUsd: 0.4, tokensIn: 0, tokensOut: 0 }) })
    const second = await guard.run({ label: 'b', worstCaseUsd: 0.3, call })
    expect(second).toEqual({ ok: false, skipped: 'budget' })
    expect(call).not.toHaveBeenCalled()
  })

  it('reservas de chamadas em andamento contam (duas ao mesmo tempo não estouram juntas)', async () => {
    const store = new InMemoryJobStore()
    const job = await running(store)
    expect(await store.reserve(job.id, 0.35)).toBeTruthy()
    expect(await store.reserve(job.id, 0.3)).toBeNull()
  })

  it('teto MENSAL da empresa (US$ 50) também bloqueia', async () => {
    const store = new InMemoryJobStore(() => Date.now(), 0.1)
    const job = await running(store)
    const guard = new BudgetGuard(store, job.id)
    expect(await guard.run({ label: 'x', worstCaseUsd: 0.2, call: async () => ({ result: 1, actualUsd: 0, tokensIn: 0, tokensOut: 0 }) })).toEqual({ ok: false, skipped: 'budget' })
  })

  it('etapa OPCIONAL para em 80% do teto; obrigatória ainda roda', async () => {
    const store = new InMemoryJobStore()
    const job = await running(store)
    const guard = new BudgetGuard(store, job.id)
    await guard.run({ label: 'gasto', worstCaseUsd: 0.5, call: async () => ({ result: 1, actualUsd: 0.5, tokensIn: 0, tokensOut: 0 }) })
    expect(await guard.run({ label: 'extra', worstCaseUsd: 0.01, optional: true, call: async () => ({ result: 1, actualUsd: 0.01, tokensIn: 0, tokensOut: 0 }) })).toEqual({ ok: false, skipped: 'soft_limit' })
    expect((await guard.run({ label: 'obrigatoria', worstCaseUsd: 0.05, call: async () => ({ result: 1, actualUsd: 0.05, tokensIn: 0, tokensOut: 0 }) })).ok).toBe(true)
  })

  it('erro COMPROVADAMENTE sem cobrança (4xx/429/chave ausente) devolve a reserva', async () => {
    const store = new InMemoryJobStore()
    const job = await running(store)
    const guard = new BudgetGuard(store, job.id)
    const out = await guard.run({ label: 'falha', worstCaseUsd: 0.3, call: async () => { throw markNotCharged(new Error('400 recusado')) } })
    expect(out).toMatchObject({ ok: false, skipped: 'error', charged: 'none' })
    const row = (await store.get(job.id))!
    expect(row.reserved_usd).toBe(0)
    expect(row.unconfirmed_usd).toBe(0)
  })

  it('modelo desconhecido (pior caso infinito) nunca é chamado', async () => {
    const store = new InMemoryJobStore()
    const job = await running(store)
    const call = vi.fn()
    expect(await new BudgetGuard(store, job.id).run({ label: 'x', worstCaseUsd: Number.POSITIVE_INFINITY, call })).toEqual({ ok: false, skipped: 'unknown_model' })
    expect(call).not.toHaveBeenCalled()
  })
})
