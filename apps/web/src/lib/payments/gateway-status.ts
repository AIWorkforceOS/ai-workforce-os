import type { SupabaseClient } from '@supabase/supabase-js'

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
