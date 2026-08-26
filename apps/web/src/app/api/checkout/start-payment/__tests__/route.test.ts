import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'

// Mudança de arquitetura (2026-08-26): este endpoint substitui o antigo
// app/api/checkout/complete — não cria mais conta nenhuma, só valida os
// dados, registra um rascunho em pending_signups e devolve o link do
// checkout hospedado da processadora. A conta só nasce depois, quando o
// webhook confirma o pagamento (ver lib/payments/webhook-handler.ts).

const sendPaymentGateBlockedEmail = vi.fn(async () => ({ ok: true }))
const sendPaymentChargeFailedEmail = vi.fn(async () => ({ ok: true }))

function requestBody(overrides: Record<string, unknown> = {}) {
  return {
    company: 'Padaria Estrela',
    name: 'Maria Silva',
    email: 'maria@padaria.com',
    phone: '+55 11 99999-0000',
    plan: 'starter',
    locale: 'pt',
    termsAccepted: true,
    ...overrides,
  }
}

function makeRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/checkout/start-payment', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

describe('POST /api/checkout/start-payment', () => {
  beforeEach(() => {
    vi.resetModules()
    sendPaymentGateBlockedEmail.mockClear()
    sendPaymentChargeFailedEmail.mockClear()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('recusa quando termsAccepted não é true', async () => {
    const { supabase, db } = createFakeSupabase({ users: [], payment_gateway_settings: [] })
    vi.doMock('@/lib/supabase/service', () => ({ createServiceClient: () => supabase }))
    vi.doMock('@/lib/email', () => ({ sendPaymentGateBlockedEmail, sendPaymentChargeFailedEmail }))

    const { POST } = await import('../route')
    const response = await POST(makeRequest(requestBody({ termsAccepted: false })))

    expect(response.status).toBe(400)
    expect(db.pending_signups ?? []).toHaveLength(0)
  })

  it('e-mail já cadastrado: recusa sem criar rascunho nenhum', async () => {
    const { supabase, db } = createFakeSupabase({
      users: [{ id: 'u-1', email: 'maria@padaria.com', role: 'admin', is_active: true }],
    })
    vi.doMock('@/lib/supabase/service', () => ({ createServiceClient: () => supabase }))
    vi.doMock('@/lib/email', () => ({ sendPaymentGateBlockedEmail, sendPaymentChargeFailedEmail }))

    const { POST } = await import('../route')
    const response = await POST(makeRequest(requestBody()))

    expect(response.status).toBe(409)
    expect(db.pending_signups ?? []).toHaveLength(0)
  })

  it('sem processadora ativa pra região: bloqueia o cadastro (não cria conta nem rascunho) e notifica os admins', async () => {
    const { supabase, db } = createFakeSupabase({
      users: [{ id: 'admin-1', email: 'dono@alizo.com.br', role: 'super_admin', is_active: true }],
      payment_gateway_settings: [],
    })
    vi.doMock('@/lib/supabase/service', () => ({ createServiceClient: () => supabase }))
    vi.doMock('@/lib/email', () => ({ sendPaymentGateBlockedEmail, sendPaymentChargeFailedEmail }))

    const { POST } = await import('../route')
    const response = await POST(makeRequest(requestBody()))

    expect(response.status).toBe(503)
    expect(db.pending_signups ?? []).toHaveLength(0)
    expect(db.organizations ?? []).toHaveLength(0)
    expect(sendPaymentGateBlockedEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'dono@alizo.com.br', region: 'BR' }))
  })

  it('processadora ativa: cria o rascunho em pending_signups e devolve o paymentUrl do checkout hospedado', async () => {
    const { supabase, db } = createFakeSupabase({
      users: [{ id: 'admin-1', email: 'dono@alizo.com.br', role: 'super_admin', is_active: true }],
      payment_gateway_settings: [{ region: 'BR', provider: 'asaas', credentials: { api_key: 'abc' }, is_active: true }],
    })
    const fetchMock = vi.fn(async (url: string) => {
      const u = String(url)
      if (u.includes('/customers')) return new Response(JSON.stringify({ id: 'cus_123' }), { status: 200 })
      if (u.includes('/checkouts')) {
        return new Response(JSON.stringify({ id: 'checkout_123', link: 'https://asaas.com/checkoutSession/show/checkout_123' }), { status: 200 })
      }
      return new Response('{}', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)

    vi.doMock('@/lib/supabase/service', () => ({ createServiceClient: () => supabase }))
    vi.doMock('@/lib/email', () => ({ sendPaymentGateBlockedEmail, sendPaymentChargeFailedEmail }))

    const { POST } = await import('../route')
    const response = await POST(makeRequest(requestBody()))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ ok: true, paymentUrl: 'https://asaas.com/checkoutSession/show/checkout_123' })

    // Nenhuma conta criada ainda — só o rascunho, com as refs da processadora já preenchidas
    expect(db.organizations ?? []).toHaveLength(0)
    expect(db.pending_signups).toHaveLength(1)
    expect((db.pending_signups as Array<Record<string, unknown>>)[0]).toMatchObject({
      company: 'Padaria Estrela',
      email: 'maria@padaria.com',
      plan: 'starter',
      currency: 'BRL',
      amount: 497,
      provider: 'asaas',
      provider_customer_ref: 'cus_123',
      provider_charge_ref: 'checkout_123',
      status: 'pending',
    })
  })

  it('processadora ativa mas a cobrança falha: não deixa rascunho órfão pra trás, devolve erro e notifica os admins', async () => {
    const { supabase, db } = createFakeSupabase({
      users: [{ id: 'admin-1', email: 'dono@alizo.com.br', role: 'super_admin', is_active: true }],
      payment_gateway_settings: [{ region: 'BR', provider: 'asaas', credentials: { api_key: 'abc' }, is_active: true }],
    })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ errors: [{ description: 'chave inválida' }] }), { status: 401 })))

    vi.doMock('@/lib/supabase/service', () => ({ createServiceClient: () => supabase }))
    vi.doMock('@/lib/email', () => ({ sendPaymentGateBlockedEmail, sendPaymentChargeFailedEmail }))

    const { POST } = await import('../route')
    const response = await POST(makeRequest(requestBody()))

    expect(response.status).toBe(502)
    expect(db.pending_signups ?? []).toHaveLength(0)
    expect(sendPaymentChargeFailedEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'dono@alizo.com.br', provider: 'asaas' }))
  })

  it('plano enterprise: recusa (sob consulta, não passa pelo checkout automático)', async () => {
    const { supabase } = createFakeSupabase({ payment_gateway_settings: [] })
    vi.doMock('@/lib/supabase/service', () => ({ createServiceClient: () => supabase }))
    vi.doMock('@/lib/email', () => ({ sendPaymentGateBlockedEmail, sendPaymentChargeFailedEmail }))

    const { POST } = await import('../route')
    const response = await POST(makeRequest(requestBody({ plan: 'enterprise' })))

    expect(response.status).toBe(400)
  })
})
