import type { SupabaseClient } from '@supabase/supabase-js'
import { createAsaasProvider } from './asaas-provider'
import { createStripeProvider } from './stripe-provider'
import type { PaymentProvider } from './provider'

export type PaymentRegion = 'BR' | 'US'

/**
 * Fonte única de verdade: uma região só está pronta pra cobrar quando existe
 * ao menos uma linha ativa em payment_gateway_settings com credenciais
 * preenchidas — os dois campos que o painel Super Admin → Pagamentos já grava
 * (payment-gateway-form.tsx). Sem flag de código: assim que o super admin
 * marcar "processadora ativa" com as chaves certas, o gate cai sozinho, sem
 * deploy novo. Erro de consulta (ex.: migration ainda não aplicada) conta
 * como "não configurado" — mais seguro bloquear do que liberar cadastro sem
 * como cobrar.
 */
export async function isPaymentPlatformConfigured(
  service: SupabaseClient,
  region: PaymentRegion,
): Promise<boolean> {
  const { data, error } = await service
    .from('payment_gateway_settings')
    .select('credentials')
    .eq('region', region)
    .eq('is_active', true)

  if (error || !data) return false

  return data.some((row) => {
    const credentials = row.credentials as Record<string, string> | null
    return !!credentials && Object.values(credentials).some((v) => typeof v === 'string' && v.trim() !== '')
  })
}

const PROVIDER_FACTORIES: Record<string, (credentials: Record<string, string>) => PaymentProvider | null> = {
  asaas: (c) => (c.api_key ? createAsaasProvider(c.api_key) : null),
  stripe: (c) => (c.secret_key ? createStripeProvider(c.secret_key) : null),
}

/**
 * Instancia o PaymentProvider real (Asaas/Stripe) pra região, lendo a
 * linha ativa com credenciais preenchidas em payment_gateway_settings.
 * Retorna null quando não há processadora pronta pra cobrar de verdade
 * (nunca lança). Desde 2026-08-26 (ver app/api/checkout/start-payment),
 * null aqui BLOQUEIA o cadastro — pagamento aprovado é pré-requisito
 * pra conta existir, não uma tentativa best-effort depois.
 */
export async function getPaymentProviderForRegion(
  service: SupabaseClient,
  region: PaymentRegion,
): Promise<PaymentProvider | null> {
  const { data, error } = await service
    .from('payment_gateway_settings')
    .select('provider, credentials')
    .eq('region', region)
    .eq('is_active', true)

  if (error || !data) return null

  for (const row of data) {
    const provider = row.provider as string
    const credentials = (row.credentials as Record<string, string> | null) ?? {}
    const factory = PROVIDER_FACTORIES[provider]
    if (!factory) continue
    const instance = factory(credentials)
    if (instance) return instance
  }
  return null
}

/**
 * Instancia o PaymentProvider por id de processadora (organizations.billing_provider),
 * não por região — usado pelo fluxo de cancelamento (app/api/billing/cancel),
 * que precisa reinstanciar a MESMA processadora que a org já usa pra cobrar,
 * independente de qual região está ativa hoje em payment_gateway_settings.
 */
export async function getPaymentProviderById(
  service: SupabaseClient,
  providerId: string,
): Promise<PaymentProvider | null> {
  const { data, error } = await service
    .from('payment_gateway_settings')
    .select('credentials')
    .eq('provider', providerId)
    .eq('is_active', true)
    .maybeSingle()

  if (error || !data) return null
  const factory = PROVIDER_FACTORIES[providerId]
  if (!factory) return null
  return factory((data.credentials as Record<string, string> | null) ?? {})
}
