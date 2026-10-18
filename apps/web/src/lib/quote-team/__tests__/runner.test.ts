import { describe, expect, it, vi } from 'vitest'
import { QUOTE_STAGES } from '../config'
import { InMemoryJobStore, type NewQuoteJob } from '../job-store'
import { NonRetryableError, runQuoteJob, type StageHandler, type StageHandlers } from '../runner'

const newJob = (): NewQuoteJob => ({ org_id: 'o', unit_id: 'u', appointment_id: 'a', idempotency_key: 'k' + Math.random(), trigger_source: 'save', mode: 'shadow', input_snapshot: {}, photo_count: 5, photo_exception_reason: null, budget_usd: 0.6, created_by: null })
const ok = (result: unknown = { ok: true }, needsAi = true): StageHandler => ({ needsAi, run: async () => ({ kind: 'done', result }) })
const allOk = (): StageHandlers => Object.fromEntries(QUOTE_STAGES.map((s) => [s, ok({ stage: s }, s !== 'costing' && s !== 'audit')])) as StageHandlers

function setup() {
  let clock = 1_000_000
  const store = new InMemoryJobStore(() => clock)
  const advance = (ms: number) => void (clock += ms)
  return { store, advance, now: () => clock }
}

describe('runQuoteJob', () => {
  it('pipeline completo: grava resultado de cada etapa e termina "completed"', async () => {
    const { store, now } = setup()
    const { job } = await store.insert(newJob())
    const out = await runQuoteJob({ store, handlers: allOk(), worker: 'w', now }, job.id)
    expect(out.kind).toBe('completed')
    const row = (await store.get(job.id))!
    expect(row.status).toBe('completed')
    expect(row.stage).toBe('done')
    expect(Object.keys(row.step_results)).toEqual([...QUOTE_STAGES])
    expect(row.locked_until).toBeNull()
  })

  it('RETOMADA: etapa 3 falha uma vez → reagenda com espera; na próxima passada NÃO refaz as etapas 1–2', async () => {
    const { store, advance, now } = setup()
    const { job } = await store.insert(newJob())
    const diag = vi.fn(async () => ({ kind: 'done' as const, result: 'd' }))
    const mat = vi.fn(async () => ({ kind: 'done' as const, result: 'm' }))
    let fails = 1
    const pricing = vi.fn(async () => {
      if (fails-- > 0) throw new Error('OpenAI 503')
      return { kind: 'done' as const, result: 'p' }
    })
    const handlers = { ...allOk(), diagnosis: { needsAi: true, run: diag }, materials: { needsAi: true, run: mat }, pricing: { needsAi: true, run: pricing } }

    const first = await runQuoteJob({ store, handlers, worker: 'w', now }, job.id)
    expect(first.kind).toBe('retry_scheduled')
    let row = (await store.get(job.id))!
    expect(row.status).toBe('queued')
    expect(row.attempt_count).toBe(1)
    expect(Date.parse(row.next_run_at)).toBeGreaterThan(now())
    expect(Object.keys(row.step_results)).toEqual(['diagnosis', 'materials'])

    expect((await runQuoteJob({ store, handlers, worker: 'w', now }, null)).kind).toBe('not_claimed') // ainda em espera
    advance(60_000)
    const second = await runQuoteJob({ store, handlers, worker: 'w', now }, null)
    expect(second.kind).toBe('completed')
    expect(diag).toHaveBeenCalledTimes(1)
    expect(mat).toHaveBeenCalledTimes(1)
    expect(pricing).toHaveBeenCalledTimes(2)
    row = (await store.get(job.id))!
    expect(row.status).toBe('completed')
  })

  it('esgotou as tentativas: "failed", mantendo os resultados parciais (cotação manual segue possível)', async () => {
    const { store, advance, now } = setup()
    const { job } = await store.insert(newJob())
    const handlers = { ...allOk(), labor: { needsAi: true, run: async () => { throw new Error('boom') } } }
    for (let i = 0; i < 3; i++) {
      await runQuoteJob({ store, handlers, worker: 'w', now }, null)
      advance(10 * 60_000)
    }
    const row = (await store.get(job.id))!
    expect(row.status).toBe('failed')
    expect(row.attempt_count).toBe(3)
    expect(Object.keys(row.step_results)).toEqual(['diagnosis', 'materials', 'pricing'])
    expect(row.error_code).toBe('stage_failed')
  })

  it('TIMEOUT de etapa vira nova tentativa (não trava o worker)', async () => {
    const { store, now } = setup()
    const { job } = await store.insert(newJob())
    const handlers = { ...allOk(), diagnosis: { needsAi: true, run: () => new Promise<never>(() => {}) } }
    const out = await runQuoteJob({ store, handlers, worker: 'w', now, stageTimeoutMs: 30 }, job.id)
    expect(out.kind).toBe('retry_scheduled')
    expect((await store.get(job.id))!.error_message).toMatch(/timeout/)
  })

  it('limite de tempo da função: devolve o job à fila com tudo gravado e a próxima passada continua', async () => {
    const { store, advance, now } = setup()
    const { job } = await store.insert(newJob())
    const slow = (name: string): StageHandler => ({ needsAi: true, run: async () => { advance(100_000); return { kind: 'done', result: name } } })
    const handlers = { ...allOk(), diagnosis: slow('d'), materials: slow('m'), pricing: slow('p') }
    const first = await runQuoteJob({ store, handlers, worker: 'w', now, timeBudgetMs: 150_000 }, job.id)
    expect(first.kind).toBe('yielded')
    expect(Object.keys((await store.get(job.id))!.step_results)).toEqual(['diagnosis', 'materials'])
    const second = await runQuoteJob({ store, handlers, worker: 'w2', now }, null)
    expect(second.kind).toBe('completed')
  })

  it('LEASE: dois workers não rodam o mesmo job; depois do lease vencer, outro assume', async () => {
    const { store, advance, now } = setup()
    const { job } = await store.insert(newJob())
    await store.claim(job.id, 'w1', 300)
    expect(await runQuoteJob({ store, handlers: allOk(), worker: 'w2', now }, job.id)).toEqual({ kind: 'not_claimed' })
    advance(301_000)
    expect((await runQuoteJob({ store, handlers: allOk(), worker: 'w2', now }, job.id)).kind).toBe('completed')
  })

  it('ORÇAMENTO esgotado: preserva o parcial, pula etapas de IA, ainda roda custos/auditoria (sem IA) e lista o pendente', async () => {
    const { store, now } = setup()
    const { job } = await store.insert(newJob())
    const costing = vi.fn(async () => ({ kind: 'done' as const, result: 'custos-por-codigo' }))
    const labor = vi.fn()
    const handlers: StageHandlers = {
      ...allOk(),
      pricing: { needsAi: true, run: async () => ({ kind: 'budget_exhausted', result: { found: 2 }, pending: [{ code: 'price_pending', message_pt: '3 itens sem pesquisa de preço', item_ref: null }] }) },
      labor: { needsAi: true, run: labor },
      costing: { needsAi: false, run: costing },
    }
    const out = await runQuoteJob({ store, handlers, worker: 'w', now }, job.id)
    expect(out.kind).toBe('budget_exhausted')
    const row = (await store.get(job.id))!
    expect(row.status).toBe('budget_exhausted')
    expect(labor).not.toHaveBeenCalled()
    expect(costing).toHaveBeenCalled()
    expect(row.step_results.pricing).toEqual({ found: 2 })
    expect(row.pending_items.map((p) => p.code)).toEqual(['price_pending', 'budget_skipped'])
  })

  it('falta informação crítica: para em "needs_input" pedindo ao técnico (resultado preservado)', async () => {
    const { store, now } = setup()
    const { job } = await store.insert(newJob())
    const handlers = { ...allOk(), diagnosis: { needsAi: true, run: async () => ({ kind: 'needs_input' as const, result: { partial: 1 }, pending: [{ code: 'need_label_photo', message_pt: 'Envie foto da etiqueta do door closer.' }] }) } }
    const out = await runQuoteJob({ store, handlers, worker: 'w', now }, job.id)
    expect(out.kind).toBe('needs_input')
    const row = (await store.get(job.id))!
    expect(row.status).toBe('needs_input')
    expect(row.pending_items[0]!.message_pt).toMatch(/etiqueta/)
    expect(Object.keys(row.step_results)).toEqual(['diagnosis'])
  })

  it('sem handlers (Fase 2): falha NÃO repetível "pipeline_not_ready" — nunca gasta IA', async () => {
    const { store, now } = setup()
    const { job } = await store.insert(newJob())
    const out = await runQuoteJob({ store, handlers: {}, worker: 'w', now }, job.id)
    expect(out.kind).toBe('failed')
    expect((await store.get(job.id))!.error_code).toBe('pipeline_not_ready')
  })

  it('erro não repetível falha na hora, sem gastar as 3 tentativas', async () => {
    const { store, now } = setup()
    const { job } = await store.insert(newJob())
    const handlers = { ...allOk(), materials: { needsAi: true, run: async () => { throw new NonRetryableError('chave ausente', 'no_api_key') } } }
    expect((await runQuoteJob({ store, handlers, worker: 'w', now }, job.id)).kind).toBe('failed')
    const row = (await store.get(job.id))!
    expect(row.error_code).toBe('no_api_key')
    expect(row.attempt_count).toBe(1)
  })

  it('nenhum job à vista: not_claimed', async () => {
    const { store, now } = setup()
    expect(await runQuoteJob({ store, handlers: allOk(), worker: 'w', now }, null)).toEqual({ kind: 'not_claimed' })
  })
})
