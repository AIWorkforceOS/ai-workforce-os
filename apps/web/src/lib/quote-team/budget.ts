import { QUOTE_SOFT_BUDGET_RATIO } from './config'

/**
 * Controle de orçamento de IA: RESERVAR o pior caso ANTES de cada chamada e LIQUIDAR com o custo real depois.
 * Nenhuma chamada começa se o pior caso não couber no que resta da cotação (US$ 0,60) e do mês da empresa (US$ 50).
 */

/** USD por 1M de tokens — documentação oficial da OpenAI consultada em 17/10/2026 (padrão, contexto curto). Modelo desconhecido ⇒ NÃO roda (nunca chutar preço). */
export const MODEL_PRICING_PER_1M: Record<string, { input: number; output: number }> = {
  'gpt-6-luna': { input: 0.1, output: 0.5 },
  'gpt-6.1-sol': { input: 2, output: 10 },
  'gpt-6-astra': { input: 10, output: 50 },
  'gpt-5.4-mini': { input: 0.75, output: 4.5 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
}

/** Ferramenta web_search (Responses API): US$ 10 por 1.000 chamadas + tokens de conteúdo recuperado na taxa do modelo. */
export const WEB_SEARCH_CALL_USD = 0.01

export type CostInput = {
  model: string
  inputTokens: number
  outputTokens: number
  webSearchCalls?: number
  /** Tokens de conteúdo recuperado pelas buscas (cobrados como entrada). */
  searchContentTokens?: number
}

export function costUsd(input: CostInput): number {
  const price = MODEL_PRICING_PER_1M[input.model]
  if (!price) return Number.POSITIVE_INFINITY
  const tokens = (input.inputTokens + (input.searchContentTokens ?? 0)) * price.input + input.outputTokens * price.output
  return tokens / 1_000_000 + (input.webSearchCalls ?? 0) * WEB_SEARCH_CALL_USD
}

/** Pior caso de uma chamada: saída no máximo permitido (max_output_tokens SEMPRE definido) + buscas + conteúdo recuperado no limite configurado. */
export function worstCaseUsd(input: { model: string; inputTokens: number; maxOutputTokens: number; webSearchCalls?: number; maxSearchContentTokensPerCall?: number }): number {
  return costUsd({
    model: input.model,
    inputTokens: input.inputTokens,
    outputTokens: input.maxOutputTokens,
    webSearchCalls: input.webSearchCalls,
    searchContentTokens: (input.webSearchCalls ?? 0) * (input.maxSearchContentTokensPerCall ?? 0),
  })
}

export type BudgetSnapshot = { budget: number; spent: number; reserved: number }

export interface BudgetStore {
  /** Atômico: só reserva se couber no teto da cotação E no teto mensal da empresa. */
  reserve(jobId: string, usd: number): Promise<boolean>
  settle(jobId: string, reservedUsd: number, actualUsd: number, tokensIn: number, tokensOut: number): Promise<void>
  snapshot(jobId: string): Promise<BudgetSnapshot | null>
}

export type GuardedResult<T> =
  | { ok: true; result: T; actualUsd: number }
  | { ok: false; skipped: 'budget' | 'soft_limit' | 'unknown_model' | 'error'; error?: Error }

export class BudgetGuard {
  constructor(private readonly store: BudgetStore, private readonly jobId: string, private readonly onSettled?: (e: { label: string; actualUsd: number; tokensIn: number; tokensOut: number }) => void | Promise<void>) {}

  /**
   * @param optional etapas opcionais (buscas extras, segunda opinião) param em ~80% do teto.
   */
  async run<T>(params: {
    label: string
    worstCaseUsd: number
    optional?: boolean
    call: () => Promise<{ result: T; actualUsd: number; tokensIn: number; tokensOut: number }>
  }): Promise<GuardedResult<T>> {
    if (!Number.isFinite(params.worstCaseUsd)) return { ok: false, skipped: 'unknown_model' }

    if (params.optional) {
      const snap = await this.store.snapshot(this.jobId)
      if (snap && snap.spent + snap.reserved >= snap.budget * QUOTE_SOFT_BUDGET_RATIO) return { ok: false, skipped: 'soft_limit' }
    }

    // reservar antes de gastar
    if (!(await this.store.reserve(this.jobId, params.worstCaseUsd))) return { ok: false, skipped: 'budget' }

    try {
      const out = await params.call()
      await this.store.settle(this.jobId, params.worstCaseUsd, out.actualUsd, out.tokensIn, out.tokensOut)
      await this.onSettled?.({ label: params.label, actualUsd: out.actualUsd, tokensIn: out.tokensIn, tokensOut: out.tokensOut })
      return { ok: true, result: out.result, actualUsd: out.actualUsd }
    } catch (error) {
      // Falhou sem resposta medida: devolve a reserva (custo real desconhecido = 0; chamadas que falham antes de responder não geram uso).
      await this.store.settle(this.jobId, params.worstCaseUsd, 0, 0, 0).catch(() => {})
      return { ok: false, skipped: 'error', error: error instanceof Error ? error : new Error(String(error)) }
    }
  }
}
