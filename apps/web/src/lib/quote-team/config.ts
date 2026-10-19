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
/**
 * Tempo máximo que uma ROTA (cron ou execução imediata) gasta começando etapas: 180 s + a etapa mais longa (90 s) = 270 s < maxDuration 300 s.
 * (O padrão do runner, 240 s, somado a uma etapa de 90 s passaria de 300 s e a função seria cortada no meio.)
 */
export const ROUTE_TIME_BUDGET_MS = 180_000
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

/** Quantas análises (jobs) novas uma mesma ordem pode abrir por dia — trava contra reanálise em loop (cada job tem o seu teto, mas o mês também conta). */
export const MAX_JOBS_PER_APPOINTMENT_PER_DAY = 3
/** Quantos jobs podem rodar ao mesmo tempo (o cron por minuto pode sobrepor invocações). */
export const MAX_CONCURRENT_JOBS = 3

/**
 * Modelos por etapa — SEMPRE configuráveis e fixados só depois do teste comparativo (decisão do Vinicius): nada é trocado
 * em produção sem teste e rollback. Padrões = perfil "Padrão" a testar. Override por variável de ambiente.
 */
export type QuoteModelStage = 'diagnosis' | 'materials' | 'pricing' | 'labor' | 'audit'
const DEFAULT_MODELS: Record<QuoteModelStage, string> = {
  diagnosis: 'gpt-6-luna',
  materials: 'gpt-6-luna',
  pricing: 'gpt-6-luna',
  labor: 'gpt-6-luna',
  audit: 'gpt-6-luna',
}
export function quoteModelFor(stage: QuoteModelStage, env: Record<string, string | undefined> = process.env): string {
  return env[`QUOTE_MODEL_${stage.toUpperCase()}`]?.trim() || DEFAULT_MODELS[stage]
}

/** Limites do diagnóstico visual. */
export const DIAGNOSIS_MAX_PHOTOS = 8
export const DIAGNOSIS_IMAGE_MAX_SIDE = 1024
export const DIAGNOSIS_MAX_OUTPUT_TOKENS = 2500
/** Modelo mais capaz para o diagnóstico, usado só quando o primeiro resultado vem com baixa confiança E há orçamento (etapa opcional). */
export function diagnosisEscalationModel(env: Record<string, string | undefined> = process.env): string {
  return env.QUOTE_MODEL_DIAGNOSIS_ESCALATION?.trim() || 'gpt-6.1-sol'
}

// ---------- Piloto MAWI: conversa, revisões e pesquisa de preços ----------
/** Rodadas máximas por cotação (respostas do técnico + pedidos de revisão): trava de loop; o orçamento de US$ 0,60 é da cotação inteira. */
export const QUOTE_MAX_ROUNDS = 6
/** Depois desta rodada o agente NÃO bloqueia mais a análise pedindo informação: segue com pendências e o técnico continua manualmente. */
export const QUOTE_MAX_BLOCKING_QUESTION_ROUNDS = 2

/** Fornecedores de referência do piloto (decisão do Vinicius). Nenhum fornecedor pago externo sem autorização. */
export const PRICE_SEARCH_ALLOWED_DOMAINS = ['homedepot.com', 'lowes.com', 'grainger.com'] as const
export const PRICE_SEARCH_MAX_ITEMS = 8
export const PRICE_SEARCH_MAX_OUTPUT_TOKENS = 1200
/** A pesquisa real (web_search da OpenAI) só roda com PRICE_SEARCH_ENABLED=true — antes disso os preços ficam "pendentes" e o técnico preenche. */
export function isPriceSearchEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.QUOTE_PRICE_SEARCH_ENABLED === 'true'
}

export const MATERIALS_MAX_OUTPUT_TOKENS = 2500
export const LABOR_MAX_OUTPUT_TOKENS = 1500
