import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/billing/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/billing/cancel', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('sem sessão, recusa com 401', async () => {
    vi.doMock('@/lib/app-user', () => ({ getAppUser: async () => null }))
    const { POST } = await import('../route')
    const response = await POST(makeRequest({ reason: 'Muito caro' }))
    expect(response.status).toBe(401)
  })

  it('sem motivo no body, recusa com 400', async () => {
    vi.doMock('@/lib/app-user', () => ({ getAppUser: async () => ({ orgId: 'org-1' }) }))
    const { POST } = await import('../route')
    const response = await POST(makeRequest({}))
    expect(response.status).toBe(400)
  })

  it('org já cancelada: devolve ok/alreadyCanceled sem tentar cancelar de novo na processadora', async () => {
    const { supabase } = createFakeSupabase({
      organizations: [{ id: 'org-1', billing_status: 'canceled', billing_provider: 'asaas', billing_provider_subscription_ref: 'sub_1' }],
    })
    const cancelSubscription = vi.fn()
    vi.doMock('@/lib/app-user', () => ({ getAppUser: async () => ({ orgId: 'org-1' }) }))
    vi.doMock('@/lib/supabase/service', () => ({ createServiceClient: () => supabase }))
    vi.doMock('@/lib/payments/gateway-status', () => ({ getPaymentProviderById: async () => ({ cancelSubscription }) }))

    const { POST } = await import('../route')
    const response = await POST(makeRequest({ reason: 'Muito caro' }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ ok: true, alreadyCanceled: true })
    expect(cancelSubscription).not.toHaveBeenCalled()
  })

  it('cancela na processadora e grava billing_status=canceled + motivo + cancelled_at', async () => {
    const { supabase, db } = createFakeSupabase({
      organizations: [{ id: 'org-1', billing_status: 'active', billing_provider: 'asaas', billing_provider_subscription_ref: 'sub_1' }],
    })
    const cancelSubscription = vi.fn(async () => ({ ok: true }))
    vi.doMock('@/lib/app-user', () => ({ getAppUser: async () => ({ orgId: 'org-1' }) }))
    vi.doMock('@/lib/supabase/service', () => ({ createServiceClient: () => supabase }))
    vi.doMock('@/lib/payments/gateway-status', () => ({ getPaymentProviderById: async () => ({ cancelSubscription }) }))

    const { POST } = await import('../route')
    const response = await POST(makeRequest({ reason: 'Muito caro pro que eu preciso hoje' }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ ok: true, refunded: false })
    expect(cancelSubscription).toHaveBeenCalledWith('sub_1')

    const org = (db.organizations as Array<Record<string, unknown>>)[0]!
    expect(org.billing_status).toBe('canceled')
    expect(org.cancellation_reason).toBe('Muito caro pro que eu preciso hoje')
    expect(org.cancelled_at).toBeTruthy()
  })

  it('falha ao cancelar na processadora: devolve 502 e NÃO marca a org como cancelada (evita inconsistência: continuar cobrando mas achar que já parou)', async () => {
    const { supabase, db } = createFakeSupabase({
      organizations: [{ id: 'org-1', billing_status: 'active', billing_provider: 'asaas', billing_provider_subscription_ref: 'sub_1' }],
    })
    const cancelSubscription = vi.fn(async () => ({ ok: false, error: 'assinatura já processando cobrança' }))
    vi.doMock('@/lib/app-user', () => ({ getAppUser: async () => ({ orgId: 'org-1' }) }))
    vi.doMock('@/lib/supabase/service', () => ({ createServiceClient: () => supabase }))
    vi.doMock('@/lib/payments/gateway-status', () => ({ getPaymentProviderById: async () => ({ cancelSubscription }) }))

    const { POST } = await import('../route')
    const response = await POST(makeRequest({ reason: 'Muito caro' }))

    expect(response.status).toBe(502)
    const org = (db.organizations as Array<Record<string, unknown>>)[0]!
    expect(org.billing_status).toBe('active')
  })

  it('org sem assinatura na processadora (ex.: ainda em trial): cancela só do nosso lado, sem chamar a processadora', async () => {
    const { supabase, db } = createFakeSupabase({
      organizations: [{ id: 'org-1', billing_status: 'trialing', billing_provider: null, billing_provider_subscription_ref: null }],
    })
    const getPaymentProviderById = vi.fn()
    vi.doMock('@/lib/app-user', () => ({ getAppUser: async () => ({ orgId: 'org-1' }) }))
    vi.doMock('@/lib/supabase/service', () => ({ createServiceClient: () => supabase }))
    vi.doMock('@/lib/payments/gateway-status', () => ({ getPaymentProviderById }))

    const { POST } = await import('../route')
    const response = await POST(makeRequest({ reason: 'Não usei o suficiente' }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ ok: true, refunded: false })
    expect(getPaymentProviderById).not.toHaveBeenCalled()
    expect((db.organizations as Array<Record<string, unknown>>)[0]!.billing_status).toBe('canceled')
  })

  describe('garantia de 7 dias — estorno automático', () => {
    function daysAgoIso(days: number): string {
      return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
    }

    it('pagamento confirmado há 2 dias: estorna automaticamente via refundPayment antes de cancelar', async () => {
      const { supabase, db } = createFakeSupabase({
        organizations: [{ id: 'org-1', billing_status: 'active', billing_provider: 'asaas', billing_provider_subscription_ref: 'sub_1' }],
        financial_records: [
          { id: 'fr-1', org_id: 'org-1', category: 'client_payment', status: 'paid', paid_at: daysAgoIso(2), provider_payment_ref: 'pay_123', amount: 497 },
        ],
      })
      const cancelSubscription = vi.fn(async () => ({ ok: true }))
      const refundPayment = vi.fn(async () => ({ ok: true }))
      vi.doMock('@/lib/app-user', () => ({ getAppUser: async () => ({ orgId: 'org-1' }) }))
      vi.doMock('@/lib/supabase/service', () => ({ createServiceClient: () => supabase }))
      vi.doMock('@/lib/payments/gateway-status', () => ({ getPaymentProviderById: async () => ({ cancelSubscription, refundPayment }) }))

      const { POST } = await import('../route')
      const response = await POST(makeRequest({ reason: 'Não usei o suficiente' }))
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body).toEqual({ ok: true, refunded: true })
      expect(refundPayment).toHaveBeenCalledWith('pay_123')
      expect((db.financial_records as Array<Record<string, unknown>>)[0]!.status).toBe('cancelled')
    })

    it('pagamento confirmado há 10 dias (fora da garantia): NÃO estorna, só cancela a recorrência futura', async () => {
      const { supabase, db } = createFakeSupabase({
        organizations: [{ id: 'org-1', billing_status: 'active', billing_provider: 'asaas', billing_provider_subscription_ref: 'sub_1' }],
        financial_records: [
          { id: 'fr-1', org_id: 'org-1', category: 'client_payment', status: 'paid', paid_at: daysAgoIso(10), provider_payment_ref: 'pay_123', amount: 497 },
        ],
      })
      const cancelSubscription = vi.fn(async () => ({ ok: true }))
      const refundPayment = vi.fn(async () => ({ ok: true }))
      vi.doMock('@/lib/app-user', () => ({ getAppUser: async () => ({ orgId: 'org-1' }) }))
      vi.doMock('@/lib/supabase/service', () => ({ createServiceClient: () => supabase }))
      vi.doMock('@/lib/payments/gateway-status', () => ({ getPaymentProviderById: async () => ({ cancelSubscription, refundPayment }) }))

      const { POST } = await import('../route')
      const response = await POST(makeRequest({ reason: 'Não usei o suficiente' }))
      const body = await response.json()

      expect(body).toEqual({ ok: true, refunded: false })
      expect(refundPayment).not.toHaveBeenCalled()
      expect((db.financial_records as Array<Record<string, unknown>>)[0]!.status).toBe('paid')
    })

    it('dentro da garantia, mas o estorno falha na processadora: ainda cancela (não deixa o cliente preso), mas refunded=false e loga pra resolução manual', async () => {
      const { supabase, db } = createFakeSupabase({
        organizations: [{ id: 'org-1', billing_status: 'active', billing_provider: 'asaas', billing_provider_subscription_ref: 'sub_1' }],
        financial_records: [
          { id: 'fr-1', org_id: 'org-1', category: 'client_payment', status: 'paid', paid_at: daysAgoIso(1), provider_payment_ref: 'pay_123', amount: 497 },
        ],
      })
      const cancelSubscription = vi.fn(async () => ({ ok: true }))
      const refundPayment = vi.fn(async () => ({ ok: false, error: 'cobrança já estornada' }))
      vi.doMock('@/lib/app-user', () => ({ getAppUser: async () => ({ orgId: 'org-1' }) }))
      vi.doMock('@/lib/supabase/service', () => ({ createServiceClient: () => supabase }))
      vi.doMock('@/lib/payments/gateway-status', () => ({ getPaymentProviderById: async () => ({ cancelSubscription, refundPayment }) }))

      const { POST } = await import('../route')
      const response = await POST(makeRequest({ reason: 'Não usei o suficiente' }))
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body).toEqual({ ok: true, refunded: false })
      expect((db.organizations as Array<Record<string, unknown>>)[0]!.billing_status).toBe('canceled')
      const events = (db.system_events ?? []) as Array<{ event_type: string }>
      expect(events.some((e) => e.event_type === 'billing_refund_failed')).toBe(true)
    })
  })
})
