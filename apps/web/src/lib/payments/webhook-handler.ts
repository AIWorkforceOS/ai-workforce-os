import type { SupabaseClient } from '@supabase/supabase-js'
import type { PaymentProvider, PaymentWebhookEvent } from './provider'
import { logSystemEvent } from '../system-events'
import type { Organization } from '../types'
import { provisionOrgFromSignup } from '../checkout/provision'
import { generateAccessLink } from '../auth/access-link'
import { sendWelcomeEmail } from '../email'

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
  // payment_failed não está mapeado aqui de propósito — nenhum dos dois
  // providers emite mais esse tipo (Asaas PAYMENT_OVERDUE e Stripe
  // invoice.payment_failed vão direto pra 'past_due', ver
  // asaas-provider.ts/stripe-provider.ts). Decisão do produto
  // (2026-08-25): pagamento recorrente que não efetiva bloqueia o uso na
  // hora (ver lib/payments/billing-gate.ts), sem tolerância de 1ª falha.
}

const FINANCIAL_RECORD_STATUS_MAP: Partial<Record<PaymentWebhookEvent['type'], 'paid' | 'overdue' | 'cancelled'>> = {
  payment_success: 'paid',
  subscription_activated: 'paid',
  past_due: 'overdue',
  canceled: 'cancelled',
  subscription_canceled: 'cancelled',
  refunded: 'cancelled',
}

type JustProvisioned = { email: string; name: string; company: string }

/**
 * Mudança de arquitetura (2026-08-26): o checkout não cria mais a conta
 * antes de cobrar — ela só nasce aqui, quando o 1º pagamento é aprovado
 * de verdade (payment_success), a partir de um pending_signups criado no
 * início do checkout (ver app/api/checkout/start-payment). Sem pagamento
 * aprovado, nenhuma organization/unit/user chega a existir.
 */
async function resolveOrCreateOrgFromPendingSignup(
  supabase: SupabaseClient,
  providerId: string,
  event: PaymentWebhookEvent,
): Promise<{ org: { id: string } | null; justProvisioned: JustProvisioned | null }> {
  if (event.type !== 'payment_success') return { org: null, justProvisioned: null }

  let pending: Record<string, unknown> | null = null
  if (event.providerCustomerRef) {
    const { data } = await supabase
      .from('pending_signups')
      .select('*')
      .eq('provider', providerId)
      .eq('provider_customer_ref', event.providerCustomerRef)
      .maybeSingle()
    pending = data
  }
  if (!pending && event.providerChargeRef) {
    const { data } = await supabase
      .from('pending_signups')
      .select('*')
      .eq('provider', providerId)
      .eq('provider_charge_ref', event.providerChargeRef)
      .maybeSingle()
    pending = data
  }
  if (!pending) return { org: null, justProvisioned: null }

  // Reentrega do mesmo webhook depois de já ter provisionado — usa a org
  // que já existe, nunca provisiona de novo.
  if (pending.status === 'completed' && pending.org_id) {
    return { org: { id: pending.org_id as string }, justProvisioned: null }
  }

  const result = await provisionOrgFromSignup(supabase, {
    company: pending.company as string,
    name: pending.name as string,
    email: pending.email as string,
    phone: (pending.phone as string | null) ?? null,
    plan: pending.plan as string,
    currency: pending.currency as 'BRL' | 'USD',
    amount: Number(pending.amount),
    paymentMethod: pending.payment_method as string,
    region: pending.region as 'BR' | 'US',
    termsVersion: pending.terms_version as string,
    privacyVersion: pending.privacy_version as string,
    acceptIp: (pending.accept_ip as string | null) ?? null,
  })
  if (!result.ok) {
    await logSystemEvent(supabase, {
      level: 'error',
      source: 'checkout',
      eventType: 'pending_signup_provision_failed',
      message: `Pagamento aprovado (${providerId}), mas não foi possível provisionar a conta: ${result.error}`,
      metadata: { pendingSignupId: pending.id, email: pending.email, provider: providerId },
    })
    return { org: null, justProvisioned: null }
  }

  await supabase
    .from('organizations')
    .update({
      billing_provider: providerId,
      billing_provider_customer_ref: event.providerCustomerRef,
      billing_provider_subscription_ref: event.providerChargeRef,
    })
    .eq('id', result.orgId)

  await supabase
    .from('pending_signups')
    .update({ status: 'completed', org_id: result.orgId, completed_at: new Date().toISOString() })
    .eq('id', pending.id)

  return {
    org: { id: result.orgId },
    justProvisioned: { email: pending.email as string, name: pending.name as string, company: pending.company as string },
  }
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

  // Nenhuma org existente bate — pode ser o 1º pagamento de um cadastro
  // que ainda não foi provisionado (pending_signups). Só então a conta
  // nasce de verdade (ver comentário em resolveOrCreateOrgFromPendingSignup).
  let justProvisioned: JustProvisioned | null = null
  if (!org) {
    const resolved = await resolveOrCreateOrgFromPendingSignup(supabase, provider.id, event)
    org = resolved.org
    justProvisioned = resolved.justProvisioned
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

  // Corrige a referência de assinatura pro id REAL quando o evento o
  // revela (ver comentário em PaymentWebhookEvent.providerSubscriptionRef)
  // — sem isso, cancelSubscription (chamado pelo fluxo de cancelamento do
  // cliente) tentaria cancelar o id errado (sessão/checkout, não assinatura).
  if (event.providerSubscriptionRef) {
    await supabase
      .from('organizations')
      .update({ billing_provider_subscription_ref: event.providerSubscriptionRef })
      .eq('id', org.id)
  }

  // financial_records: só atualiza o registro pendente da cobrança em
  // questão (não cria linha nova). Quando confirma pagamento, também
  // grava provider_payment_ref (migration 075) — necessário pro estorno
  // automático da garantia de 7 dias (ver app/api/billing/cancel) saber
  // EXATAMENTE qual cobrança reembolsar na processadora.
  const financialStatus = FINANCIAL_RECORD_STATUS_MAP[event.type]
  if (financialStatus) {
    await supabase
      .from('financial_records')
      .update({
        status: financialStatus,
        paid_at: financialStatus === 'paid' ? new Date().toISOString() : null,
        ...(financialStatus === 'paid' && event.providerPaymentRef ? { provider_payment_ref: event.providerPaymentRef } : {}),
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

  // Conta acabou de ser provisionada por este webhook — manda o e-mail de
  // boas-vindas com link de primeiro acesso (sem senha em texto puro em
  // lugar nenhum, mesmo padrão do admin criando conta pro cliente).
  if (justProvisioned) {
    const appUrl = (process.env.NEXT_PUBLIC_APP_URL || 'https://www.alizoai.com').replace(/\/+$/, '')
    const accessLink = await generateAccessLink(supabase, justProvisioned.email, `${appUrl}/auth/set-password`)
    const welcomeResult = await sendWelcomeEmail({
      to: justProvisioned.email,
      name: justProvisioned.name,
      companyName: justProvisioned.company,
      setPasswordUrl: accessLink.ok ? accessLink.link : null,
      paymentUrl: null,
    })
    if (!accessLink.ok || !welcomeResult.ok) {
      await logSystemEvent(supabase, {
        level: 'warning',
        source: 'checkout',
        eventType: 'welcome_email_failed',
        message: `Conta de "${justProvisioned.company}" provisionada com sucesso após pagamento aprovado, mas ${
          !accessLink.ok ? `o link de acesso falhou: ${accessLink.error}` : `o e-mail de boas-vindas falhou: ${welcomeResult.error ?? 'erro desconhecido'}`
        }.`,
        orgId: org.id,
        metadata: { email: justProvisioned.email },
      })
    }
  }

  return { status: 200, body: { ok: true } }
}
