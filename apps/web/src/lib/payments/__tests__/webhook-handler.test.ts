import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'
import { handlePaymentWebhook } from '../webhook-handler'
import type { PaymentProvider, PaymentWebhookEvent } from '../provider'
import * as emailModule from '@/lib/email'
import * as accessLinkModule from '@/lib/auth/access-link'

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

  describe('regressão (2026-08-26): pagamento aprovado provisiona a conta a partir de pending_signups', () => {
    beforeEach(() => {
      vi.restoreAllMocks()
    })

    function pendingSignupRow(overrides: Record<string, unknown> = {}) {
      return {
        id: 'ps-1',
        company: 'Padaria Estrela',
        name: 'Maria Silva',
        email: 'maria@padaria.com',
        phone: '+55 11 99999-0000',
        plan: 'starter',
        currency: 'BRL',
        region: 'BR',
        locale: 'pt',
        amount: 497,
        payment_method: 'card',
        provider: 'asaas',
        provider_customer_ref: 'cus_9',
        provider_charge_ref: 'checkout_9',
        terms_version: '2026-08-19-draft1',
        privacy_version: '2026-08-19-draft1',
        accept_ip: '1.2.3.4',
        status: 'pending',
        org_id: null,
        ...overrides,
      }
    }

    it('sem org e sem pending_signups batendo: continua "organization_not_found" (comportamento antigo intocado)', async () => {
      const { supabase, db } = createFakeSupabase({ organizations: [], pending_signups: [] })
      const event: PaymentWebhookEvent = {
        externalEventId: 'evt_ghost',
        type: 'payment_success',
        providerChargeRef: 'checkout_ghost',
        providerCustomerRef: 'cus_ghost',
        raw: {},
      }
      const provider = fakeProvider({ parseWebhookEvent: () => event })

      const result = await handlePaymentWebhook({ supabase, provider, rawBody: '{}', headers: new Headers() })

      expect(result.body.skipped).toBe('organization_not_found')
      expect(db.organizations ?? []).toHaveLength(0)
    })

    it('evento que não é payment_success (ex.: past_due) sem org batendo: NÃO tenta provisionar a partir de pending_signups', async () => {
      const { supabase, db } = createFakeSupabase({
        organizations: [],
        pending_signups: [pendingSignupRow()],
      })
      const event: PaymentWebhookEvent = {
        externalEventId: 'evt_past_due',
        type: 'past_due',
        providerChargeRef: 'checkout_9',
        providerCustomerRef: 'cus_9',
        raw: {},
      }
      const provider = fakeProvider({ parseWebhookEvent: () => event })

      const result = await handlePaymentWebhook({ supabase, provider, rawBody: '{}', headers: new Headers() })

      expect(result.body.skipped).toBe('organization_not_found')
      expect(db.organizations ?? []).toHaveLength(0)
      expect((db.pending_signups as Array<{ status: string }>)[0]!.status).toBe('pending')
    })

    it('payment_success batendo por providerCustomerRef: provisiona a conta, ativa billing, marca a cobrança paga, completa o pending_signups e manda o e-mail de boas-vindas com link de acesso', async () => {
      const { supabase, db } = createFakeSupabase({ organizations: [], pending_signups: [pendingSignupRow()] })
      vi.spyOn(accessLinkModule, 'generateAccessLink').mockResolvedValue({ ok: true, link: 'https://app/auth/set-password?token=abc', linkType: 'invite' })
      const sendWelcomeEmail = vi.spyOn(emailModule, 'sendWelcomeEmail').mockResolvedValue({ ok: true })

      const event: PaymentWebhookEvent = {
        externalEventId: 'PAYMENT_CONFIRMED:pay_1',
        type: 'payment_success',
        providerChargeRef: 'checkout_9',
        providerCustomerRef: 'cus_9',
        providerPaymentRef: 'pay_1',
        raw: {},
      }
      const provider = fakeProvider({ parseWebhookEvent: () => event })

      const result = await handlePaymentWebhook({ supabase, provider, rawBody: '{}', headers: new Headers() })

      expect(result.status).toBe(200)
      expect(db.organizations).toHaveLength(1)
      const org = (db.organizations as Array<Record<string, unknown>>)[0]!
      expect(org.billing_status).toBe('active')
      expect(org.billing_provider).toBe('asaas')
      expect(org.billing_provider_customer_ref).toBe('cus_9')

      expect(db.financial_records).toHaveLength(1)
      const record = (db.financial_records as Array<Record<string, unknown>>)[0]!
      expect(record.status).toBe('paid')
      expect(record.provider_payment_ref).toBe('pay_1')

      const pending = (db.pending_signups as Array<Record<string, unknown>>)[0]!
      expect(pending.status).toBe('completed')
      expect(pending.org_id).toBe(org.id)

      expect(sendWelcomeEmail).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'maria@padaria.com', companyName: 'Padaria Estrela', setPasswordUrl: 'https://app/auth/set-password?token=abc' }),
      )
    })

    it('providerCustomerRef não bate em nada, mas providerChargeRef bate: resolve por fallback', async () => {
      const { supabase, db } = createFakeSupabase({
        organizations: [],
        pending_signups: [pendingSignupRow({ provider_customer_ref: 'cus_9', provider_charge_ref: 'checkout_9' })],
      })
      vi.spyOn(accessLinkModule, 'generateAccessLink').mockResolvedValue({ ok: true, link: 'https://x', linkType: 'invite' })
      vi.spyOn(emailModule, 'sendWelcomeEmail').mockResolvedValue({ ok: true })

      const event: PaymentWebhookEvent = {
        externalEventId: 'evt_by_charge_ref',
        type: 'payment_success',
        providerChargeRef: 'checkout_9',
        providerCustomerRef: 'cus_outro', // não bate com o pending_signups
        raw: {},
      }
      const provider = fakeProvider({ parseWebhookEvent: () => event })

      const result = await handlePaymentWebhook({ supabase, provider, rawBody: '{}', headers: new Headers() })

      expect(result.status).toBe(200)
      expect(db.organizations).toHaveLength(1)
    })

    it('reentrega do mesmo webhook depois de já ter provisionado (pending_signups já completed): reaproveita a org existente, não provisiona de novo', async () => {
      const { supabase, db } = createFakeSupabase({
        organizations: [{ id: 'org-already', billing_status: 'active' }],
        pending_signups: [pendingSignupRow({ status: 'completed', org_id: 'org-already' })],
      })
      const sendWelcomeEmail = vi.spyOn(emailModule, 'sendWelcomeEmail').mockResolvedValue({ ok: true })

      const event: PaymentWebhookEvent = {
        externalEventId: 'evt_retry',
        type: 'payment_success',
        providerChargeRef: 'checkout_9',
        providerCustomerRef: 'cus_9',
        raw: {},
      }
      const provider = fakeProvider({ parseWebhookEvent: () => event })

      const result = await handlePaymentWebhook({ supabase, provider, rawBody: '{}', headers: new Headers() })

      expect(result.status).toBe(200)
      // Não duplica organização nenhuma nem manda e-mail de novo
      expect(db.organizations).toHaveLength(1)
      expect(sendWelcomeEmail).not.toHaveBeenCalled()
    })

    it('o provisionamento falha (ex.: erro no banco ao criar a unidade): loga o erro e trata como organization_not_found, sem deixar nada pela metade', async () => {
      const { supabase, db } = createFakeSupabase(
        { organizations: [], pending_signups: [pendingSignupRow()] },
        { units: { insert: 'unidade: falha simulada' } },
      )

      const event: PaymentWebhookEvent = {
        externalEventId: 'evt_provision_fail',
        type: 'payment_success',
        providerChargeRef: 'checkout_9',
        providerCustomerRef: 'cus_9',
        raw: {},
      }
      const provider = fakeProvider({ parseWebhookEvent: () => event })

      const result = await handlePaymentWebhook({ supabase, provider, rawBody: '{}', headers: new Headers() })

      expect(result.body.skipped).toBe('organization_not_found')
      expect(db.organizations ?? []).toHaveLength(0)
      const events = (db.system_events ?? []) as Array<{ event_type: string }>
      expect(events.some((e) => e.event_type === 'pending_signup_provision_failed')).toBe(true)
    })
  })
})
