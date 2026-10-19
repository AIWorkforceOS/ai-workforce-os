import { describe, expect, it } from 'vitest'
import { PRICE_SEARCH_ALLOWED_DOMAINS } from '../../config'
import { InMemoryJobStore } from '../../job-store'
import { createPricingHandler, priceCacheKey, selectBestOption, snippetShowsPrice, verifyOptions, type VerifiedOption } from '../pricing'
import { MockStructuredModel } from '../structured-model'
import { materialsFixture, stageContext } from './helpers'

const D = PRICE_SEARCH_ALLOWED_DOMAINS
const opt = (over: Record<string, unknown> = {}) => ({ supplier: 'Home Depot', product_url: 'https://www.homedepot.com/p/closer/123', title: 'Closer', brand: null, model: null, sku: null, price: 29.97, currency: 'USD', snippet: 'Door closer $29.97 each', match_score: 0.9, compatibility_note: null, ...over })
const cited = [{ url: 'https://www.homedepot.com/p/closer/123?utm_source=x', title: null }]

describe('snippetShowsPrice', () => {
  it('só aceita o preço se o número aparece no trecho citado', () => {
    expect(snippetShowsPrice('Door closer $29.97 each', 29.97)).toBe(true)
    expect(snippetShowsPrice('Price: 29.97', 29.97)).toBe(true)
    expect(snippetShowsPrice('Sale $129.97', 29.97)).toBe(false)
    expect(snippetShowsPrice('Door closer', 29.97)).toBe(false)
    expect(snippetShowsPrice(null, 29.97)).toBe(false)
    expect(snippetShowsPrice('Now $13', 13)).toBe(true)
    expect(snippetShowsPrice('Now $1,299.00', 1299)).toBe(true)
  })
})

describe('verifyOptions — a IA propõe, o código decide', () => {
  it('link citado + domínio permitido + preço no trecho = verificado', () => {
    const [o] = verifyOptions([opt()], cited, D)
    expect(o).toMatchObject({ verified: true, price: 29.97, reason: null })
  })
  it('link que a busca NÃO devolveu (possivelmente inventado) é descartado', () => {
    expect(verifyOptions([opt({ product_url: 'https://www.homedepot.com/p/invented/999' })], cited, D)).toHaveLength(0)
  })
  it('domínio fora da lista e http são descartados', () => {
    expect(verifyOptions([opt({ product_url: 'https://www.amazon.com/dp/B0' })], [{ url: 'https://www.amazon.com/dp/B0' }], D)).toHaveLength(0)
    expect(verifyOptions([opt({ product_url: 'http://www.homedepot.com/p/closer/123' })], cited, D)).toHaveLength(0)
  })
  it('preço sem evidência no trecho é ZERADO: produto fica "não confirmado"', () => {
    const [o] = verifyOptions([opt({ snippet: 'Great closer' })], cited, D)
    expect(o).toMatchObject({ verified: false, price: null })
    expect(o!.reason).toMatch(/sem evidência/i)
  })
  it('sem preço exibido: link mantido, preço nulo', () => {
    const [o] = verifyOptions([opt({ price: null, snippet: null })], cited, D)
    expect(o).toMatchObject({ verified: false, price: null })
  })
  it('moeda diferente de USD não vale como preço', () => {
    expect(verifyOptions([opt({ currency: 'EUR' })], cited, D)[0]).toMatchObject({ verified: false, price: null })
  })
})

describe('selectBestOption', () => {
  const v = (price: number, score: number, verified = true) => ({ ...opt({ price, match_score: score }), verified, reason: null }) as VerifiedOption
  it('escolhe a verificada de maior compatibilidade; empate = menor preço', () => {
    expect(selectBestOption([v(10, 0.7), v(20, 0.9), v(15, 0.9)])).toBe(2)
  })
  it('ignora não verificadas e match abaixo de 0,6', () => {
    expect(selectBestOption([v(10, 0.9, false), v(12, 0.5)])).toBeNull()
  })
})

describe('createPricingHandler', () => {
  const materials = materialsFixture([{ name_en: 'Door closer' }, { name_en: 'Screwdriver', kind: 'tool' }, { name_en: 'Screws', kind: 'consumable', necessity: 'conditional' }]).items

  it('com a pesquisa desligada TODO preço fica pendente (o técnico preenche) e nenhum modelo é chamado', async () => {
    const model = new MockStructuredModel(() => ({ output: { options: [] } }))
    const { ctx } = await stageContext({ stepResults: { materials: { items: materials } } })
    const out = await createPricingHandler({ model, enabled: () => false }).run(ctx)
    expect(out.kind).toBe('done')
    expect(model.calls).toHaveLength(0)
    const r = (out as { result: { enabled: boolean; items: { status: string }[] } }).result
    expect(r.enabled).toBe(false)
    expect(r.items.map((i) => i.status)).toEqual(['pending', 'pending']) // ferramenta não é cobrável/pesquisada
    expect((out as { pending: { code: string }[] }).pending[0]!.code).toBe('prices_manual')
  })

  it('ligada: pesquisa só itens não-ferramenta, verifica e registra custo real; ferramenta fica de fora', async () => {
    const model = new MockStructuredModel((input) => ({ output: { options: [opt()] }, citations: cited, webSearchCalls: 1, outputTokens: 400, inputTokens: 3000, model: input.model }))
    const { ctx, store, job } = await stageContext({ stepResults: { materials: { items: materials } } })
    const out = await createPricingHandler({ model, enabled: () => true }).run(ctx)
    const r = (out as { result: { items: { status: string; selected: number | null }[]; searches: number; cost_usd: number } }).result
    expect(model.calls).toHaveLength(2)
    expect(model.calls[0]!.webSearch?.allowedDomains).toEqual([...D])
    expect(r.items.every((i) => i.status === 'verified')).toBe(true)
    expect(r.searches).toBe(2)
    const row = (await store.get(job.id))!
    expect(row.spent_usd).toBeGreaterThan(0.02) // 2 buscas × US$ 0,01 + tokens
    expect(row.reserved_usd).toBe(0)
  })

  it('link inventado ⇒ item "não encontrado/pendente", nunca preço', async () => {
    const model = new MockStructuredModel(() => ({ output: { options: [opt({ product_url: 'https://www.lowes.com/pd/made-up/1' })] }, citations: [] }))
    const { ctx } = await stageContext({ stepResults: { materials: { items: materials } } })
    const out = await createPricingHandler({ model, enabled: () => true }).run(ctx)
    const r = (out as { result: { items: { status: string; options: unknown[] }[] } }).result
    expect(r.items.every((i) => i.status === 'not_found' && i.options.length === 0)).toBe(true)
  })

  it('para ao passar de 80% do teto: restantes ficam pendentes e o teto nunca é furado', async () => {
    const model = new MockStructuredModel(() => ({ output: { options: [opt()] }, citations: cited, webSearchCalls: 1 }))
    const { ctx, store, job } = await stageContext({ stepResults: { materials: { items: materials } }, budget: 0.04 })
    const out = await createPricingHandler({ model, enabled: () => true }).run(ctx)
    const r = (out as { result: { items: { status: string }[] } }).result
    expect(r.items.some((i) => i.status === 'skipped')).toBe(true)
    const row = (await store.get(job.id))!
    expect(row.spent_usd + row.reserved_usd + row.unconfirmed_usd).toBeLessThanOrEqual(0.04 + 1e-9)
  })

  it('usa o cache (sem chamar o modelo) e só guarda resultados verificados', async () => {
    const store = new Map<string, VerifiedOption[]>()
    const cache = { get: async (k: string) => store.get(k) ?? null, put: async (k: string, v: VerifiedOption[]) => void store.set(k, v) }
    const model = new MockStructuredModel(() => ({ output: { options: [opt()] }, citations: cited, webSearchCalls: 1 }))
    const handler = createPricingHandler({ model, cache, enabled: () => true })
    const first = await stageContext({ stepResults: { materials: { items: materials } } })
    await handler.run(first.ctx)
    const callsAfterFirst = model.calls.length
    expect(store.size).toBe(2)
    const second = await stageContext({ stepResults: { materials: { items: materials } } })
    await handler.run(second.ctx)
    expect(model.calls.length).toBe(callsAfterFirst)
    expect(priceCacheKey({ name_en: ' Door  Closer ', brand: null, model: null, part_number: null, dimensions: null })).toBe('door closer||||')
  })

  it('falhas seguidas interrompem a pesquisa sem derrubar a cotação', async () => {
    const model = new MockStructuredModel(() => {
      throw new Error('503')
    })
    const many = materialsFixture([{ name_en: 'A' }, { name_en: 'B' }, { name_en: 'C' }]).items
    const { ctx } = await stageContext({ stepResults: { materials: { items: many } } })
    const out = await createPricingHandler({ model, enabled: () => true }).run(ctx)
    expect(out.kind).toBe('done')
    const r = (out as { result: { items: { status: string }[] } }).result
    expect(r.items.map((i) => i.status)).toEqual(['pending', 'pending', 'skipped'])
  })
})

describe('InMemoryJobStore sanity', () => {
  it('existe', () => expect(new InMemoryJobStore()).toBeTruthy())
})
