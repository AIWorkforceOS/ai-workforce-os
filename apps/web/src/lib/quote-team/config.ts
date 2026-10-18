/**
 * Super Agente de Cotações — constantes e interruptores.
 * REGRAS COMERCIAIS (valor/hora, markup, impostos…) NÃO ficam aqui nem em nenhum arquivo de código:
 * vivem em quote_rate_cards (somente admin). Aqui só ficam limites técnicos e de orçamento de IA.
 */

export type QuoteTeamMode = 'off' | 'shadow' | 'live'

/** Teto de IA + buscas pagas por cotação (decisão do Vinicius, 17/10/2026). */
export const QUOTE_DEFAULT_BUDGET_USD = 0.6
/** Teto mensal inicial por empresa no piloto. */
export const QUOTE_DEFAULT_MONTHLY_CAP_USD = 50
/** A partir de 80% do teto, etapas OPCIONAIS (buscas extras, checagem extra) deixam de rodar. */
export const QUOTE_SOFT_BUDGET_RATIO = 0.8

/** Etapas na ordem de execução. */
export const QUOTE_STAGES = ['diagnosis', 'materials', 'pricing', 'labor', 'costing', 'audit'] as const
export type QuoteStage = (typeof QUOTE_STAGES)[number]

/** Cada passada do worker devolve o job antes de estourar o limite da função (maxDuration 300 s). */
export const RUNNER_TIME_BUDGET_MS = 240_000
export const STAGE_TIMEOUT_MS = 90_000
export const LEASE_SECONDS = 300
export const MAX_ATTEMPTS = 3
/** Espera antes da tentativa 2, 3… (ms). */
export const RETRY_BACKOFF_MS = [30_000, 120_000, 300_000]

/** Padrão operacional de fotos por cotação (exceção justificada permitida; nunca bloqueia a WO). */
export const STANDARD_PHOTO_TARGET = 5

/** Interruptor global: QUOTE_TEAM_ENABLED=false desliga tudo, independente da chave de cada unidade. */
export function isQuoteTeamKillSwitchOn(env: Record<string, string | undefined> = process.env): boolean {
  return env.QUOTE_TEAM_ENABLED === 'false'
}

export function effectiveQuoteTeamMode(unitMode: string | null | undefined, env: Record<string, string | undefined> = process.env): QuoteTeamMode {
  if (isQuoteTeamKillSwitchOn(env)) return 'off'
  return unitMode === 'shadow' || unitMode === 'live' ? unitMode : 'off'
}
