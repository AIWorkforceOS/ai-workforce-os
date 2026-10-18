import { describe, expect, it } from 'vitest'
import { BudgetGuard, committedUsd, markNotCharged } from '../budget'
import { InMemoryJobStore, type NewQuoteJob } from '../job-store'

const newJob = (over: Partial<NewQuoteJob> = {}): NewQuoteJob => ({
  org_id: 'org-1', unit_id: 'u', appointment_id: 'a', idempotency_key: 'k' + Math.random(), trigger_source: 'save', mode: 'shadow',
  input_snapshot: {}, photo_count: 5, photo_exception_reason: null, budget_usd: 0.6, created_by: null, ...over,
})
const running = async (store: InMemoryJobStore, over: Partial<NewQuoteJob> = {}) => {
  const { job } = await store.insert(newJob(over))
  await store.claim(job.id, 'w', 300)
  return job.id
}
const ok = (usd: number) => async () => ({ result: 1, actualUsd: usd, tokensIn: 10, tokensOut: 5 })

describe('três baldes: confirmado x ativo x não confirmado', () => {
  it('cada balde é separado e os três contam no teto da cotação', async () => {
    const store = new InMemoryJobStore()
    const id = await running(store)
    const g = new BudgetGuard(store, id)
    await g.run({ label: 'a', worstCaseUsd: 0.1, call: ok(0.04) }) // confirmado 0,04
    await g.run({ label: 'b', worstCaseUsd: 0.2, call: async () => { throw new Error('timeout') } }) // não confirmado 0,20
    const active = await store.reserve(id, 0.1) // ativo 0,10
    expect(active).toBeTruthy()
    const snap = (await store.snapshot(id))!
    expect(snap).toMatchObject({ spent: 0.04, unconfirmed: 0.2 })
    expect(snap.reserved).toBeCloseTo(0.1)
    expect(committedUsd(snap)).toBeCloseTo(0.34)
    // 0,34 comprometidos: 0,27 não cabe, 0,26 cabe
    expect(await store.reserve(id, 0.27)).toBeNull()
    expect(await store.reserve(id, 0.26)).toBeTruthy()
  })

  it('o teto de US$ 0,60 vale mesmo com várias falhas ambíguas seguidas', async () => {
    const store = new InMemoryJobStore()
    const id = await running(store)
    const g = new BudgetGuard(store, id)
    const outs = []
    for (let i = 0; i < 5; i++) outs.push(await g.run({ label: 'f' + i, worstCaseUsd: 0.2, call: async () => { throw new Error('502') } }))
    expect(outs.filter((o) => !o.ok && o.skipped === 'error')).toHaveLength(3) // 3 × 0,20 = 0,60
    expect(outs.filter((o) => !o.ok && o.skipped === 'budget')).toHaveLength(2)
    expect(committedUsd((await store.snapshot(id))!)).toBeCloseTo(0.6)
  })
})

describe('liquidação idempotente (sem cobrança duplicada)', () => {
  it('liquidar a MESMA reserva duas vezes cobra uma só', async () => {
    const store = new InMemoryJobStore()
    const id = await running(store)
    const r = (await store.reserve(id, 0.2))!
    expect(await store.settle(r, 0.05, 100, 50)).toBe(true)
    expect(await store.settle(r, 0.05, 100, 50)).toBe(false)
    const row = (await store.get(id))!
    expect(row.spent_usd).toBeCloseTo(0.05)
    expect(row.ai_calls).toBe(1)
    expect(row.tokens_in).toBe(100)
  })
  it('liberar depois de liquidar (ou duas vezes) não devolve nada a mais', async () => {
    const store = new InMemoryJobStore()
    const id = await running(store)
    const r = (await store.reserve(id, 0.2))!
    await store.settle(r, 0.05, 0, 0)
    expect(await store.release(r)).toBe(false)
    expect(await store.markUnconfirmed(r)).toBe(false)
    const r2 = (await store.reserve(id, 0.1))!
    expect(await store.release(r2)).toBe(true)
    expect(await store.release(r2)).toBe(false)
    expect((await store.get(id))!.reserved_usd).toBe(0)
  })
  it('falha ao gravar a liquidação não descarta o resultado nem devolve a reserva', async () => {
    const store = new InMemoryJobStore()
    const id = await running(store)
    const realSettle = store.settle.bind(store)
    store.settle = async () => { throw new Error('rede caiu') }
    const out = await new BudgetGuard(store, id).run({ label: 'x', worstCaseUsd: 0.2, call: ok(0.03) })
    expect(out.ok).toBe(true)
    store.settle = realSettle
    const row = (await store.get(id))!
    expect(row.reserved_usd).toBeCloseTo(0.2) // continua contando; a varredura a tornará "não confirmada"
  })
  it('worker lento que responde DEPOIS da varredura: a estimativa preventiva vira custo real (sem duplicar)', async () => {
    let clock = 1_000_000
    const store = new InMemoryJobStore(() => clock)
    const id = await running(store)
    const r = (await store.reserve(id, 0.3))!
    await store.update(id, { status: 'failed', locked_by: null, locked_until: null })
    clock += 11 * 60_000
    await store.reconcileBudgets(10)
    expect((await store.get(id))!.unconfirmed_usd).toBeCloseTo(0.3)
    expect(await store.settle(r, 0.04, 1, 1)).toBe(true)
    const row = (await store.get(id))!
    expect(row).toMatchObject({ unconfirmed_usd: 0, reserved_usd: 0 })
    expect(row.spent_usd).toBeCloseTo(0.04)
  })
})

describe('classificação de falhas', () => {
  it('sem cobrança comprovada: libera; ambígua: mantém', async () => {
    const store = new InMemoryJobStore()
    const id = await running(store)
    const g = new BudgetGuard(store, id)
    await g.run({ label: 'a', worstCaseUsd: 0.1, call: async () => { throw markNotCharged(new Error('429')) } })
    expect(committedUsd((await store.snapshot(id))!)).toBe(0)
    await g.run({ label: 'b', worstCaseUsd: 0.1, call: async () => { throw new Error('ECONNRESET') } })
    expect(committedUsd((await store.snapshot(id))!)).toBeCloseTo(0.1)
  })
})

describe('reconciliação posterior com dados reais', () => {
  it('troca o pior caso pelo custo real (inclusive 0) e libera orçamento; é idempotente', async () => {
    const store = new InMemoryJobStore()
    const id = await running(store)
    const g = new BudgetGuard(store, id)
    const out = await g.run({ label: 'b', worstCaseUsd: 0.3, call: async () => { throw new Error('timeout') } })
    const rid = (out as { reservationId: string }).reservationId
    expect(committedUsd((await store.snapshot(id))!)).toBeCloseTo(0.3)
    expect(await store.reconcileReservation(rid, 0.02, 'relatório OpenAI')).toBe(true)
    expect(await store.reconcileReservation(rid, 0.02)).toBe(false)
    const row = (await store.get(id))!
    expect(row.unconfirmed_usd).toBe(0)
    expect(row.spent_usd).toBeCloseTo(0.02)
    expect(committedUsd((await store.snapshot(id))!)).toBeCloseTo(0.02)
    // 0 = a chamada nunca foi cobrada
    const out2 = await g.run({ label: 'c', worstCaseUsd: 0.1, call: async () => { throw new Error('timeout') } })
    await store.reconcileReservation((out2 as { reservationId: string }).reservationId, 0)
    expect((await store.get(id))!.spent_usd).toBeCloseTo(0.02)
  })
  it('só reserva "não confirmada" pode ser reconciliada (ativa ou já liquidada, não)', async () => {
    const store = new InMemoryJobStore()
    const id = await running(store)
    const active = (await store.reserve(id, 0.1))!
    expect(await store.reconcileReservation(active, 0.01)).toBe(false)
    await store.settle(active, 0.01, 0, 0)
    expect(await store.reconcileReservation(active, 0.5)).toBe(false)
    expect((await store.get(id))!.spent_usd).toBeCloseTo(0.01)
  })
})

describe('teto mensal com o razão', () => {
  it('não confirmado de um job continua bloqueando OUTROS jobs da empresa até reconciliar', async () => {
    const store = new InMemoryJobStore(() => Date.now(), 0.5)
    const a = await running(store)
    const b = await running(store)
    const out = await new BudgetGuard(store, a).run({ label: 'x', worstCaseUsd: 0.4, call: async () => { throw new Error('timeout') } })
    expect(await store.reserve(b, 0.2)).toBeNull() // 0,4 + 0,2 > 0,5
    await store.reconcileReservation((out as { reservationId: string }).reservationId, 0.01)
    expect(await store.reserve(b, 0.2)).toBeTruthy()
  })
  it('custo real acima do pior caso é registrado (alarme), nunca perdido', async () => {
    const store = new InMemoryJobStore()
    const id = await running(store)
    const r = (await store.reserve(id, 0.1))!
    await store.settle(r, 0.15, 0, 0)
    expect((await store.get(id))!.spent_usd).toBeCloseTo(0.15)
    expect([...store.reservations.values()][0]!.overrun_usd).toBeCloseTo(0.05)
  })
})
