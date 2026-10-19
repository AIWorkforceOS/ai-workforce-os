import { PRICE_SEARCH_ALLOWED_DOMAINS, PRICE_SEARCH_MAX_ITEMS, PRICE_SEARCH_MAX_OUTPUT_TOKENS, isPriceSearchEnabled, quoteModelFor } from '../config'
import type { MaterialItem, PendingItem } from '../contracts'
import type { StageHandler } from '../runner'
import { PRICE_SEARCH_SYSTEM_PROMPT, buildPriceSearchUserText } from './prompts'
import { runStructuredStage } from './run-structured'
import { PRICE_SEARCH_JSON_SCHEMA, priceSearchLlmSchema, type PriceSearchLlm } from './schemas'
import type { StructuredModel } from './structured-model'

export type VerifiedOption = {
  supplier: string
  product_url: string
  title: string | null
  brand: string | null
  model: string | null
  sku: string | null
  price: number | null
  currency: string
  snippet: string | null
  match_score: number
  compatibility_note: string | null
  /** true só quando URL veio da busca, domínio é permitido E o preço aparece no trecho citado. */
  verified: boolean
  reason: string | null
}

export type PricedItem = {
  index: number
  name_en: string
  status: 'verified' | 'pending' | 'not_found' | 'skipped'
  reason: string | null
  options: VerifiedOption[]
  selected: number | null
  checked_at: string
}

export type PricingStageResult = { enabled: boolean; items: PricedItem[]; searches: number; cost_usd: number }

const hostMatches = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`)
const canonicalUrl = (u: string) => {
  try {
    const x = new URL(u)
    return `${x.hostname}${x.pathname.replace(/\/+$/, '')}`.toLowerCase()
  } catch {
    return null
  }
}

/** O trecho citado mostra o preço? ("$12.97" ou "12.97"; inteiro "$13" só se for exatamente 13 ou 13.00). */
export function snippetShowsPrice(snippet: string | null, price: number): boolean {
  if (!snippet) return false
  const text = snippet.replace(/,(?=\d{3}\b)/g, '')
  const candidates = new Set<string>([price.toFixed(2)])
  if (Number.isInteger(price)) candidates.add(String(price))
  return [...candidates].some((c) => new RegExp(`(^|[^\\d.])\\$?\\s?${c.replace('.', '\\.')}(?!\\d)`).test(text))
}

/**
 * Verificação DETERMINÍSTICA de cada proposta da IA (a IA só propõe; o código decide):
 *  1. link https de um domínio permitido; 2. o link tem de ter sido RETORNADO pela busca (citação) — link inventado é descartado;
 *  3. preço só vale com evidência (o número aparece no trecho citado); caso contrário o preço é zerado e o produto fica "não confirmado".
 */
export function verifyOptions(options: PriceSearchLlm['options'], citations: { url: string }[], allowedDomains: readonly string[]): VerifiedOption[] {
  const cited = new Set(citations.map((c) => canonicalUrl(c.url)).filter((v): v is string => Boolean(v)))
  const out: VerifiedOption[] = []
  for (const o of options) {
    let host: string
    try {
      const u = new URL(o.product_url)
      if (u.protocol !== 'https:') continue
      host = u.hostname.toLowerCase()
    } catch {
      continue
    }
    if (!allowedDomains.some((d) => hostMatches(host, d))) continue
    const canon = canonicalUrl(o.product_url)
    if (!canon || !cited.has(canon)) continue // link que a busca não devolveu: possivelmente inventado
    const priced = o.price != null && o.price > 0 && o.currency.toUpperCase() === 'USD'
    const evidenced = priced && snippetShowsPrice(o.snippet, o.price as number)
    out.push({
      supplier: o.supplier || host,
      product_url: o.product_url,
      title: o.title,
      brand: o.brand,
      model: o.model,
      sku: o.sku,
      price: evidenced ? o.price : null,
      currency: 'USD',
      snippet: o.snippet,
      match_score: Math.min(1, Math.max(0, o.match_score)),
      compatibility_note: o.compatibility_note,
      verified: Boolean(evidenced),
      reason: evidenced ? null : priced ? 'Preço sem evidência no trecho citado' : 'Preço não exibido na página encontrada',
    })
  }
  return out
}

/** Escolhe a melhor opção VERIFICADA (match ≥ 0,6; empate = menor preço). */
export function selectBestOption(options: VerifiedOption[]): number | null {
  let best: number | null = null
  options.forEach((o, i) => {
    if (!o.verified || o.match_score < 0.6) return
    if (best === null) best = i
    else {
      const b = options[best]!
      if (o.match_score > b.match_score || (o.match_score === b.match_score && (o.price as number) < (b.price as number))) best = i
    }
  })
  return best
}

export interface PriceCache {
  get(key: string): Promise<VerifiedOption[] | null>
  put(key: string, options: VerifiedOption[]): Promise<void>
}

export const priceCacheKey = (item: Pick<MaterialItem, 'name_en' | 'brand' | 'model' | 'part_number' | 'dimensions'>) =>
  [item.name_en, item.brand ?? '', item.model ?? '', item.part_number ?? '', item.dimensions ?? ''].map((s) => s.toLowerCase().replace(/\s+/g, ' ').trim()).join('|')

/**
 * Etapa 3 — pesquisa de produtos e preços reais (Home Depot, Lowe's, Grainger). DESLIGADA por padrão (QUOTE_PRICE_SEARCH_ENABLED=true liga):
 * desligada, todo preço fica "pendente" e o técnico preenche material/preço/fornecedor manualmente — o piloto não depende da busca.
 * Etapa OPCIONAL: ao passar de 80% do teto da cotação, os itens restantes ficam pendentes (nunca estoura o orçamento).
 */
export function createPricingHandler(deps: { model: StructuredModel | null; cache?: PriceCache; modelName?: string; enabled?: () => boolean; now?: () => Date }): StageHandler {
  return {
    needsAi: true,
    async run(ctx) {
      const materials = (ctx.stepResults.materials as { items?: MaterialItem[] } | undefined)?.items ?? []
      const now = (deps.now ?? (() => new Date()))().toISOString()
      const priceable = materials.map((item, index) => ({ item, index })).filter(({ item }) => item.kind !== 'tool')
      const enabled = (deps.enabled ?? (() => isPriceSearchEnabled()))() && deps.model !== null

      const base = (reason: string, status: PricedItem['status'] = 'pending'): PricedItem[] => priceable.map(({ item, index }) => ({ index, name_en: item.name_en, status, reason, options: [], selected: null, checked_at: now }))
      if (priceable.length === 0) return { kind: 'done', result: { enabled, items: [], searches: 0, cost_usd: 0 } satisfies PricingStageResult }
      if (!enabled) {
        const result: PricingStageResult = { enabled: false, items: base('Pesquisa automática de preços ainda não habilitada'), searches: 0, cost_usd: 0 }
        return { kind: 'done', result, pending: [{ code: 'prices_manual', message_pt: 'Preços pendentes: preencha preço, fornecedor e link de cada material manualmente.' }] }
      }

      const model = deps.modelName ?? quoteModelFor('pricing')
      const items: PricedItem[] = []
      const pending: PendingItem[] = []
      let searches = 0
      let cost = 0
      let stopReason: string | null = null
      let failures = 0

      const ordered = [...priceable].sort((a, b) => (a.item.necessity === b.item.necessity ? a.index - b.index : a.item.necessity === 'required' ? -1 : 1))
      for (const [position, { item, index }] of ordered.entries()) {
        const mark = (status: PricedItem['status'], reason: string | null, options: VerifiedOption[] = [], selected: number | null = null) => items.push({ index, name_en: item.name_en, status, reason, options, selected, checked_at: now })
        if (stopReason || position >= PRICE_SEARCH_MAX_ITEMS) {
          mark('skipped', stopReason ?? `Limite de ${PRICE_SEARCH_MAX_ITEMS} itens pesquisados por cotação`)
          continue
        }
        const key = priceCacheKey(item)
        const cached = deps.cache ? await deps.cache.get(key).catch(() => null) : null
        if (cached && cached.length > 0) {
          const selected = selectBestOption(cached)
          mark(selected !== null ? 'verified' : 'pending', selected !== null ? null : 'Produto não confirmado (resultado em cache)', cached, selected)
          continue
        }
        try {
          const run = await runStructuredStage({
            ctx,
            label: `pricing:${index}`,
            model: deps.model as StructuredModel,
            input: {
              model,
              system: PRICE_SEARCH_SYSTEM_PROMPT,
              userText: buildPriceSearchUserText(item, PRICE_SEARCH_ALLOWED_DOMAINS),
              schemaName: 'quote_price_search',
              jsonSchema: PRICE_SEARCH_JSON_SCHEMA,
              maxOutputTokens: PRICE_SEARCH_MAX_OUTPUT_TOKENS,
              webSearch: { allowedDomains: PRICE_SEARCH_ALLOWED_DOMAINS },
            },
            schema: priceSearchLlmSchema,
            optional: true,
            worstCaseSearches: 3,
            worstCaseRetrievedTokens: 20_000,
          })
          if (!run.ok) {
            stopReason = run.skipped === 'budget' ? 'Orçamento de IA da cotação esgotado' : 'Pesquisa interrompida para preservar o orçamento (80% do teto)'
            mark('skipped', stopReason)
            continue
          }
          searches += run.raw.webSearchCalls
          cost += run.costUsd
          const options = verifyOptions(run.data.options, run.raw.citations, PRICE_SEARCH_ALLOWED_DOMAINS)
          const selected = selectBestOption(options)
          if (selected !== null) {
            mark('verified', null, options, selected)
            if (deps.cache) await deps.cache.put(key, options).catch(() => undefined)
          } else if (options.length > 0) mark('pending', 'Produto encontrado, mas sem preço verificável', options)
          else mark('not_found', 'Nenhum produto confirmado nos fornecedores de referência')
          failures = 0
        } catch (error) {
          if ((error as { code?: string }).code === 'unknown_model') throw error
          failures += 1
          mark('pending', 'Falha na pesquisa deste item')
          if (failures >= 2) stopReason = 'Pesquisa interrompida após falhas seguidas'
        }
      }
      items.sort((a, b) => a.index - b.index)
      const unresolved = items.filter((i) => i.status !== 'verified')
      if (unresolved.length > 0) pending.push({ code: 'prices_pending', message_pt: `${unresolved.length} material(is) sem preço verificado: confirme ou preencha manualmente (Preço pendente / Produto não confirmado).` })
      return { kind: 'done', result: { enabled: true, items, searches, cost_usd: cost } satisfies PricingStageResult, pending }
    },
  }
}
