import type { SupabaseClient } from '@supabase/supabase-js'
import type { PaymentProvider, PaymentWebhookEvent } from './provider'
import { logSystemEvent } from '../system-events'
import type { Organization } from '../types'

/**
 * Handler compartilhado de webhook de pagamento — usado pelos endpoints
 * Asaas e Stripe (app/api/webhooks/payments/*). Concentra idempotência
 * (webhook_events), resolução de organização e atualização de
 * organizations.billing_status + financial_records (só com o schema já
 * existente, sem novas colunas) num lugar só, pra nenhum dos dois
 * providers reimplementar essa lógica.
 */

const BILLING_STATUS_MAP: Partial<Record<PaymentWebhookEvent['type'], Organization['billing_status']>> = {
  payment_success: 'active',
  subscription_activated: 'active',
  past_due: 'past_due',
  canceled: 'canceled',
  subscription_canceled: 'canceled',
  refunded: 'canceled',
  grace_period: 'grace_period',
  // payment_failed: uma falha isolada de cobrança não rebaixa o status sozinha
  // (só vira past_due quando o provider mandar esse evento explicitamente).
}

const FINANCIAL_RECORD_STATUS_MAP: Partial<Record<PaymentWebhookEvent['type'], 'paid' | 'overdue' | 'cancelled'>> = {
  payment_success: 'paid',
  subscription_activated: 'paid',
  past_due: 'overdue',
  canceled: 'cancelled',
  subscription_canceled: 'cancelled',
  refunded: 'cancelled',
}

export async function handlePaymentWebhook(params: {
  supabase: SupabaseClient
  provider: PaymentProvider
  rawBody: string
  headers: Headers
}): Promise<{ status: number; body: Record<string, unknown> }> {
  const { supabase, provider, rawBody, headers } = params

  if (!provider.verifyWebhookSignature(rawBody, headers)) {
    return { status: 403, body: { error: 'Assinatura inválida ou ausente.' } }
  }

  const event = provider.parseWebhookEvent(rawBody)
  if (!event) {
    return { status: 200, body: { ok: true, skipped: 'unmapped_event_type' } }
  }

  // Idempotência — o provider pode reentregar o mesmo evento
  const { data: existing } = await supabase
    .from('webhook_events')
    .select('id')
    .eq('provider', provider.id)
    .eq('external_event_id', event.externalEventId)
    .maybeSingle()
  if (existing) {
    return { status: 200, body: { ok: true, skipped: 'duplicate' } }
  }

  // Resolve a organização por customer ref primeiro, depois por charge/subscription ref
  let org: { id: string } | null = null
  if (event.providerCustomerRef) {
    const { data } = await supabase
      .from('organizations')
      .select('id')
      .eq('billing_provider_customer_ref', event.providerCustomerRef)
      .maybeSingle()
    org = data
  }
  if (!org && event.providerChargeRef) {
    const { data } = await supabase
      .from('organizations')
      .select('id')
      .eq('billing_provider_subscription_ref', event.providerChargeRef)
      .maybeSingle()
    org = data
  }

  await supabase.from('webhook_events').insert({
    provider: provider.id,
    external_event_id: event.externalEventId,
    event_type: event.type,
    org_id: org?.id ?? null,
    payload: event.raw as Record<string, unknown>,
    processed_at: org ? new Date().toISOString() : null,
    processing_error: org ? null : 'organization_not_found',
  })

  if (!org) {
    await logSystemEvent(supabase, {
      level: 'warning',
      source: 'checkout',
      eventType: 'payment_webhook_org_not_found',
      message: `Webhook ${provider.id} recebido (${event.type}) mas nenhuma organização bate com as referências enviadas — pode ser um evento de teste/sandbox.`,
      metadata: { provider: provider.id, eventType: event.type, providerCustomerRef: event.providerCustomerRef, providerChargeRef: event.providerChargeRef },
    })
    return { status: 200, body: { ok: true, skipped: 'organization_not_found' } }
  }

  const billingStatus = BILLING_STATUS_MAP[event.type]
  if (billingStatus) {
    await supabase.from('organizations').update({ billing_status: billingStatus }).eq('id', org.id)
  }

  // financial_records: schema/colunas existentes, sem alteração — só
  // atualiza o registro pendente da cobrança em questão (não cria linha nova).
  const financialStatus = FINANCIAL_RECORD_STATUS_MAP[event.type]
  if (financialStatus) {
    await supabase
      .from('financial_records')
      .update({
        status: financialStatus,
        paid_at: financialStatus === 'paid' ? new Date().toISOString() : null,
      })
      .eq('org_id', org.id)
      .eq('status', 'pending')
  }

  if (event.type === 'payment_failed') {
    await logSystemEvent(supabase, {
      level: 'warning',
      source: 'checkout',
      eventType: 'payment_webhook_failed',
      message: `Cobrança falhou (${provider.id}) para uma organização existente.`,
      orgId: org.id,
      metadata: { provider: provider.id },
    })
  }

  return { status: 200, body: { ok: true } }
}
