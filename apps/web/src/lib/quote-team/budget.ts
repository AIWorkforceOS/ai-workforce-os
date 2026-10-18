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

export type BudgetSnapshot = { budget: number; spent: number; reserved: number; unconfirmed: number }

/** Total que conta nos tetos: confirmado + reservas ativas + reservas interrompidas contabilizadas preventivamente. */
export const committedUsd = (s: BudgetSnapshot) => s.spent + s.reserved + s.unconfirmed

/**
 * Falha em que a chamada comprovadamente NÃO foi cobrada (nunca chegou ao provedor, ou ele a recusou sem processar: chave ausente,
 * HTTP 4xx, 429). Só esta falha libera a reserva. Qualquer outra (timeout, queda de rede, 5xx, resposta ilegível) é AMBÍGUA:
 * o provedor pode ter cobrado, então o pior caso continua contando nos tetos como "não confirmado" até reconciliar com o custo real.
 */
export function markNotCharged<E extends Error>(error: E): E & { notCharged: true } {
  return Object.assign(error, { notCharged: true as const })
}
export const isNotCharged = (error: unknown) => (error as { notCharged?: boolean } | null)?.notCharged === true

export interface BudgetStore {
  /** Atômico: só reserva se couber no teto da cotação E no teto mensal da empresa. Devolve o id da reserva (null = não coube). */
  reserve(jobId: string, usd: number): Promise<string | null>
  /** Troca a reserva pelo custo REAL. Idempotente: a mesma reserva nunca é cobrada duas vezes (devolve false na repetição). */
  settle(reservationId: string, actualUsd: number, tokensIn: number, tokensOut: number): Promise<boolean>
  /** Falha comprovadamente sem cobrança: devolve a reserva. */
  release(reservationId: string, note?: string): Promise<boolean>
  /** Falha ambígua: o pior caso continua contando, mas como "não confirmado" (reconciliável depois com o custo real). */
  markUnconfirmed(reservationId: string, note?: string): Promise<boolean>
  snapshot(jobId: string): Promise<BudgetSnapshot | null>
}

export type GuardedResult<T> =
  | { ok: true; result: T; actualUsd: number }
  | { ok: false; skipped: 'budget' | 'soft_limit' | 'unknown_model' | 'error'; error?: Error; reservationId?: string; charged?: 'none' | 'unknown' }

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
      if (snap && committedUsd(snap) >= snap.budget * QUOTE_SOFT_BUDGET_RATIO) return { ok: false, skipped: 'soft_limit' }
    }

    // reservar antes de gastar
    const reservationId = await this.store.reserve(this.jobId, params.worstCaseUsd)
    if (!reservationId) return { ok: false, skipped: 'budget' }

    let out: { result: T; actualUsd: number; tokensIn: number; tokensOut: number }
    try {
      out = await params.call()
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      if (isNotCharged(err)) {
        await this.store.release(reservationId, `sem cobrança: ${err.message}`.slice(0, 200)).catch(() => {})
        return { ok: false, skipped: 'error', error: err, reservationId, charged: 'none' }
      }
      // ambígua: NÃO devolve o orçamento (a chamada pode ter sido cobrada)
      await this.store.markUnconfirmed(reservationId, `falha ambígua: ${err.message}`.slice(0, 200)).catch(() => {})
      return { ok: false, skipped: 'error', error: err, reservationId, charged: 'unknown' }
    }

    // A chamada deu certo e o custo é conhecido: falha ao gravar NÃO pode descartar o resultado nem devolver a reserva.
    // Tenta de novo; se ainda falhar, a reserva fica ativa e a varredura a torna "não confirmada" (pior caso continua contando).
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await this.store.settle(reservationId, out.actualUsd, out.tokensIn, out.tokensOut)
        break
      } catch {
        /* tenta de novo */
      }
    }
    await this.onSettled?.({ label: params.label, actualUsd: out.actualUsd, tokensIn: out.tokensIn, tokensOut: out.tokensOut })
    return { ok: true, result: out.result, actualUsd: out.actualUsd }
  }
}
