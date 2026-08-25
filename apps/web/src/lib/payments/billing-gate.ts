import type { SupabaseClient } from '@supabase/supabase-js'
import type { Organization } from '../types'

/**
 * Bloqueio de uso por falta de pagamento (decisão do produto, 2026-08-25):
 * cobrança nunca bloqueia o CADASTRO (ver checkout/complete/route.ts,
 * organizations.billing_status nasce 'trialing'), mas uma assinatura
 * recorrente já ativa que deixa de ser paga bloqueia o uso NA HORA — sem
 * grace period, sem tolerância de 1ª falha (pedido explícito do
 * Vinicius: "caso o pagamento não seja efetivado em algum mês o sistema
 * bloqueia na hora o uso de forma automatica"). 'trialing' e 'active'
 * nunca bloqueiam; 'grace_period' também não (é aviso de trial acabando,
 * não falha de cobrança — ver stripe-provider.ts).
 */
export function isOrgBillingBlocked(billingStatus: Organization['billing_status'] | null | undefined): boolean {
  return billingStatus === 'past_due' || billingStatus === 'canceled'
}

/**
 * Busca organizations.billing_status pra decidir o bloqueio. Best-effort:
 * erro ou org sem linha vira null (= não bloqueado) — uma falha
 * transitória de leitura não deve derrubar o atendimento de todos os
 * clientes; o risco vai pro lado errado de um jeito raro passar sem ser
 * bloqueado, não pro lado de bloquear clientes pagantes por acidente.
 */
export async function fetchOrgBillingStatus(
  supabase: SupabaseClient,
  orgId: string | null | undefined,
): Promise<Organization['billing_status'] | null> {
  if (!orgId) return null
  const { data } = await supabase.from('organizations').select('billing_status').eq('id', orgId).maybeSingle()
  return (data as { billing_status?: Organization['billing_status'] } | null)?.billing_status ?? null
}
