import { describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'
import { handlePaymentWebhook } from '../webhook-handler'
import type { PaymentProvider, PaymentWebhookEvent } from '../provider'

function fakeProvider(overrides: Partial<PaymentProvider> = {}): PaymentProvider {
  return {
    id: 'asaas',
    createCustomerAndCharge: vi.fn(),
    cancelSubscription: vi.fn(),
    refundPayment: vi.fn(),
    verifyWebhookSignature: () => true,
    parseWebhookEvent: () => null,
    ...overrides,
  }
}

describe('handlePaymentWebhook', () => {
  it('rejeita com 403 quando a assinatura é inválida', async () => {
    const { supabase } = createFakeSupabase({})
    const provider = fakeProvider({ verifyWebhookSignature: () => false })

    const result = await handlePaymentWebhook({ supabase, provider, rawBody: '{}', headers: new Headers() })

    expect(result.status).toBe(403)
  })

  it('ignora (200) evento que o provider não conseguiu interpretar', async () => {
    const { supabase } = createFakeSupabase({})
    const provider = fakeProvider({ parseWebhookEvent: () => null })

    const result = await handlePaymentWebhook({ supabase, provider, rawBody: '{}', headers: new Headers() })

    expect(result.status).toBe(200)
    expect(result.body.skipped).toBe('unmapped_event_type')
  })

  it('idempotência: evento já processado (mesmo provider+external_event_id) é ignorado sem duplicar efeito', async () => {
    const { supabase, db } = createFakeSupabase({
      webhook_events: [{ id: 'we-1', provider: 'asaas', external_event_id: 'PAYMENT_CONFIRMED:pay_1' }],
      organizations: [{ id: 'org-1', billing_status: 'trialing', billing_provider_subscription_ref: 'pay_1' }],
    })
    const event: PaymentWebhookEvent = {
      externalEventId: 'PAYMENT_CONFIRMED:pay_1',
      type: 'payment_success',
      providerChargeRef: 'pay_1',
      providerCustomerRef: null,
      raw: {},
    }
    const provider = fakeProvider({ parseWebhookEvent: () => event })

    const result = await handlePaymentWebhook({ supabase, provider, rawBody: '{}', headers: new Headers() })

    expect(result.body.skipped).toBe('duplicate')
    // Não mexeu no billing_status por ser duplicado
    expect((db.organizations as Array<{ billing_status: string }>)[0]!.billing_status).toBe('trialing')
  })

  it('quando nenhuma organização bate com as referências, registra o webhook_event mas não quebra', async () => {
    const { supabase, db } = createFakeSupabase({ organizations: [] })
    const event: PaymentWebhookEvent = {
      externalEventId: 'evt_orphan',
      type: 'payment_success',
      providerChargeRef: 'pay_ghost',
      providerCustomerRef: null,
      raw: {},
    }
    const provider = fakeProvider({ parseWebhookEvent: () => event })

    const result = await handlePaymentWebhook({ supabase, provider, rawBody: '{}', headers: new Headers() })

    expect(result.body.skipped).toBe('organization_not_found')
    expect(db.webhook_events).toHaveLength(1)
    expect((db.webhook_events as Array<{ processing_error: string }>)[0]!.processing_error).toBe('organization_not_found')
  })

  it('payment_success ativa a org e marca financial_records pendente como paid', async () => {
    const { supabase, db } = createFakeSupabase({
      organizations: [{ id: 'org-1', billing_status: 'trialing', billing_provider_subscription_ref: 'pay_1' }],
      financial_records: [{ id: 'fr-1', org_id: 'org-1', status: 'pending', amount: 497 }],
    })
    const event: PaymentWebhookEvent = {
      externalEventId: 'PAYMENT_CONFIRMED:pay_1',
      type: 'payment_success',
      providerChargeRef: 'pay_1',
      providerCustomerRef: null,
      raw: {},
    }
    const provider = fakeProvider({ parseWebhookEvent: () => event })

    const result = await handlePaymentWebhook({ supabase, provider, rawBody: '{}', headers: new Headers() })

    expect(result.status).toBe(200)
    expect((db.organizations as Array<{ billing_status: string }>)[0]!.billing_status).toBe('active')
    expect((db.financial_records as Array<{ status: string }>)[0]!.status).toBe('paid')
  })

  it('regressão (2026-08-25, garantia de 7 dias): payment_success com providerPaymentRef grava financial_records.provider_payment_ref — é o que o estorno automático usa depois', async () => {
    const { supabase, db } = createFakeSupabase({
      organizations: [{ id: 'org-1', billing_status: 'trialing', billing_provider_subscription_ref: 'pay_1' }],
      financial_records: [{ id: 'fr-1', org_id: 'org-1', status: 'pending', amount: 497 }],
    })
    const event: PaymentWebhookEvent = {
      externalEventId: 'PAYMENT_CONFIRMED:pay_1',
      type: 'payment_success',
      providerChargeRef: 'pay_1',
      providerCustomerRef: null,
      providerPaymentRef: 'pay_1',
      raw: {},
    }
    const provider = fakeProvider({ parseWebhookEvent: () => event })

    await handlePaymentWebhook({ supabase, provider, rawBody: '{}', headers: new Headers() })

    expect((db.financial_records as Array<{ provider_payment_ref: string }>)[0]!.provider_payment_ref).toBe('pay_1')
  })

  it('subscription_canceled cancela a org sem tocar em financial_records já pago', async () => {
    const { supabase, db } = createFakeSupabase({
      organizations: [{ id: 'org-1', billing_status: 'active', billing_provider_subscription_ref: 'sub_1' }],
      financial_records: [{ id: 'fr-1', org_id: 'org-1', status: 'paid', amount: 497 }],
    })
    const event: PaymentWebhookEvent = {
      externalEventId: 'evt_cancel',
      type: 'subscription_canceled',
      providerChargeRef: 'sub_1',
      providerCustomerRef: null,
      raw: {},
    }
    const provider = fakeProvider({ parseWebhookEvent: () => event })

    await handlePaymentWebhook({ supabase, provider, rawBody: '{}', headers: new Headers() })

    expect((db.organizations as Array<{ billing_status: string }>)[0]!.billing_status).toBe('canceled')
    // já estava 'paid', o filtro .eq('status','pending') não deveria mexer nele
    expect((db.financial_records as Array<{ status: string }>)[0]!.status).toBe('paid')
  })

  it('payment_failed isolado não rebaixa billing_status, só loga o evento', async () => {
    const { supabase, db } = createFakeSupabase({
      organizations: [{ id: 'org-1', billing_status: 'active', billing_provider_subscription_ref: 'sub_1' }],
    })
    const event: PaymentWebhookEvent = {
      externalEventId: 'evt_fail',
      type: 'payment_failed',
      providerChargeRef: 'sub_1',
      providerCustomerRef: null,
      raw: {},
    }
    const provider = fakeProvider({ parseWebhookEvent: () => event })

    await handlePaymentWebhook({ supabase, provider, rawBody: '{}', headers: new Headers() })

    expect((db.organizations as Array<{ billing_status: string }>)[0]!.billing_status).toBe('active')
    const events = (db.system_events ?? []) as Array<{ event_type: string }>
    expect(events.some((e) => e.event_type === 'payment_webhook_failed')).toBe(true)
  })

  it('resolve a organização por providerCustomerRef quando o chargeRef não bate', async () => {
    const { supabase, db } = createFakeSupabase({
      organizations: [{ id: 'org-1', billing_status: 'trialing', billing_provider_customer_ref: 'cus_1' }],
    })
    const event: PaymentWebhookEvent = {
      externalEventId: 'evt_by_customer',
      type: 'subscription_activated',
      providerChargeRef: null,
      providerCustomerRef: 'cus_1',
      raw: {},
    }
    const provider = fakeProvider({ parseWebhookEvent: () => event })

    await handlePaymentWebhook({ supabase, provider, rawBody: '{}', headers: new Headers() })

    expect((db.organizations as Array<{ billing_status: string }>)[0]!.billing_status).toBe('active')
  })

  it('regressão (2026-08-25): quando o evento traz providerSubscriptionRef, corrige billing_provider_subscription_ref pro id real da assinatura (ex.: checkout.session.completed da Stripe, checkout da Asaas)', async () => {
    const { supabase, db } = createFakeSupabase({
      organizations: [{ id: 'org-1', billing_status: 'trialing', billing_provider_customer_ref: 'cus_1', billing_provider_subscription_ref: 'checkout_123' }],
    })
    const event: PaymentWebhookEvent = {
      externalEventId: 'evt_sub_ref',
      type: 'payment_success',
      providerChargeRef: 'pay_1',
      providerCustomerRef: 'cus_1',
      providerSubscriptionRef: 'sub_real_9',
      raw: {},
    }
    const provider = fakeProvider({ parseWebhookEvent: () => event })

    await handlePaymentWebhook({ supabase, provider, rawBody: '{}', headers: new Headers() })

    expect((db.organizations as Array<{ billing_provider_subscription_ref: string }>)[0]!.billing_provider_subscription_ref).toBe(
      'sub_real_9',
    )
  })

  it('sem providerSubscriptionRef no evento, billing_provider_subscription_ref não é tocado', async () => {
    const { supabase, db } = createFakeSupabase({
      organizations: [{ id: 'org-1', billing_status: 'trialing', billing_provider_customer_ref: 'cus_1', billing_provider_subscription_ref: 'checkout_123' }],
    })
    const event: PaymentWebhookEvent = {
      externalEventId: 'evt_no_sub_ref',
      type: 'payment_success',
      providerChargeRef: 'pay_1',
      providerCustomerRef: 'cus_1',
      raw: {},
    }
    const provider = fakeProvider({ parseWebhookEvent: () => event })

    await handlePaymentWebhook({ supabase, provider, rawBody: '{}', headers: new Headers() })

    expect((db.organizations as Array<{ billing_provider_subscription_ref: string }>)[0]!.billing_provider_subscription_ref).toBe(
      'checkout_123',
    )
  })
})
