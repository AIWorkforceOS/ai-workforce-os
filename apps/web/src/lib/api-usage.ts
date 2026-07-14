import { createServiceClient } from '@/lib/supabase/service'

/**
 * Registro de uso das APIs externas para o painel Super Admin.
 *
 * IMPORTANTE — custo ESTIMADO, não fatura: os valores em USD saem da
 * tabela de preços abaixo (preço público de tabela em jul/2026) aplicada
 * ao uso que NÓS registramos. A fatura real pode divergir (descontos,
 * tiers, mudanças de preço, chamadas feitas fora deste código). Para a
 * OpenAI, o painel também consulta o custo real via Costs API quando
 * OPENAI_ADMIN_KEY estiver configurada.
 */

export type ApiProvider = 'openai' | 'google_maps' | 'resend' | 'evolution'

// USD por 1M de tokens (OpenAI, tabela pública jul/2026)
const OPENAI_PRICING_PER_1M: Record<string, { input: number; output: number }> = {
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4o': { input: 2.5, output: 10 },
  'text-embedding-3-small': { input: 0.02, output: 0 },
}

// USD por request (Google Places, SKUs públicos — estimativa)
const GOOGLE_PLACES_PRICING_PER_REQUEST: Record<string, number> = {
  'places.textsearch': 0.032, // Text Search
  'places.details': 0.02, // Place Details + Contact Data
}

// USD por e-mail (Resend Pro US$20 / 50k e-mails — no plano free o
// custo marginal real é 0; mantemos a estimativa conservadora)
const RESEND_COST_PER_EMAIL = 0.0004

export function estimateOpenAICost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = OPENAI_PRICING_PER_1M[model] ?? { input: 0.15, output: 0.6 }
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000
}

export type ApiUsageInput = {
  provider: ApiProvider
  endpoint: string
  model?: string | null
  inputTokens?: number | null
  outputTokens?: number | null
  totalTokens?: number | null
  requestCount?: number
  estimatedCostUsd: number
  orgId?: string | null
  unitId?: string | null
  metadata?: Record<string, unknown>
}

/**
 * Grava um evento de uso de API (service role — roda fora da sessão do
 * usuário). Nunca lança: medição não pode derrubar o fluxo principal.
 */
export async function logApiUsage(usage: ApiUsageInput): Promise<void> {
  try {
    const service = createServiceClient()
    if (!service) return

    const { error } = await service.from('api_usage_events').insert({
      provider: usage.provider,
      endpoint: usage.endpoint,
      model: usage.model ?? null,
      input_tokens: usage.inputTokens ?? null,
      output_tokens: usage.outputTokens ?? null,
      total_tokens: usage.totalTokens ?? null,
      request_count: usage.requestCount ?? 1,
      estimated_cost_usd: usage.estimatedCostUsd,
      org_id: usage.orgId ?? null,
      unit_id: usage.unitId ?? null,
      metadata: usage.metadata ?? {},
    })
    if (error) console.error(`[api_usage] falha ao gravar uso: ${error.message}`)
  } catch (err) {
    console.error(`[api_usage] falha ao gravar uso: ${err instanceof Error ? err.message : String(err)}`)
  }
}

type OpenAIUsagePayload = {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
}

/** Atalho para as funções de openai.ts: extrai o usage da resposta e grava. */
export async function logOpenAIUsage(params: {
  endpoint: string
  model: string
  usage: OpenAIUsagePayload | null | undefined
}): Promise<void> {
  const inputTokens = params.usage?.prompt_tokens ?? 0
  const outputTokens = params.usage?.completion_tokens ?? 0
  await logApiUsage({
    provider: 'openai',
    endpoint: params.endpoint,
    model: params.model,
    inputTokens,
    outputTokens,
    totalTokens: params.usage?.total_tokens ?? inputTokens + outputTokens,
    estimatedCostUsd: estimateOpenAICost(params.model, inputTokens, outputTokens),
  })
}

/** Atalho para google-places.ts: custo fixo por request. */
export async function logGooglePlacesUsage(endpoint: 'places.textsearch' | 'places.details'): Promise<void> {
  await logApiUsage({
    provider: 'google_maps',
    endpoint,
    estimatedCostUsd: GOOGLE_PLACES_PRICING_PER_REQUEST[endpoint] ?? 0,
  })
}

/** Atalho para email.ts: custo estimado por e-mail enviado. */
export async function logResendUsage(): Promise<void> {
  await logApiUsage({
    provider: 'resend',
    endpoint: 'emails.send',
    estimatedCostUsd: RESEND_COST_PER_EMAIL,
  })
}

/**
 * Atalho para evolution.ts: Evolution é self-hosted — custo marginal
 * por mensagem é 0 (infra fixa); registramos só o volume.
 */
export async function logEvolutionUsage(endpoint: string): Promise<void> {
  await logApiUsage({ provider: 'evolution', endpoint, estimatedCostUsd: 0 })
}
