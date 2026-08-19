import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'

// Corrigido em 19/08/2026 (auditoria P0): o cadastro NUNCA é bloqueado por
// falta de processadora de pagamento ativa — trial/beta não podem ficar de
// fora só porque não existe cobrança imediata. Sem processadora configurada,
// a conta é criada normalmente (billing_status='trialing', o default da
// coluna) e a Alizo só é notificada pra acompanhar manualmente. Com
// processadora ativa, tentamos cobrar de verdade depois de já ter
// provisionado a conta — falha na cobrança nunca desfaz o cadastro.

const sendWelcomeEmail = vi.fn(async () => ({ ok: true }))
const sendPaymentGateBlockedEmail = vi.fn(async () => ({ ok: true }))

function requestBody(overrides: Record<string, unknown> = {}) {
  return {
    company: 'Padaria Estrela',
    name: 'Maria Silva',
    email: 'maria@padaria.com',
    phone: '+55 11 99999-0000',
    password: 'senha1234',
    plan: 'starter',
    locale: 'pt',
    paymentMethod: 'pix',
    termsAccepted: true,
    ...overrides,
  }
}

function makeRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/checkout/complete', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

function seedAuth(supabase: ReturnType<typeof createFakeSupabase>['supabase']) {
  Object.assign(supabase, {
    auth: { admin: { createUser: vi.fn(async () => ({ data: { user: { id: 'auth-1' } }, error: null })) } },
  })
}

describe('POST /api/checkout/complete — nunca bloqueia por falta de processadora', () => {
  beforeEach(() => {
    vi.resetModules()
    sendWelcomeEmail.mockClear()
    sendPaymentGateBlockedEmail.mockClear()
  })

  it('sem NENHUMA processadora ativa: cria a conta normalmente (trial), só notifica os admins', async () => {
    const { supabase, db } = createFakeSupabase({
      users: [{ id: 'admin-1', email: 'dono@alizo.com.br', role: 'super_admin', is_active: true }],
      payment_gateway_settings: [],
    })
    seedAuth(supabase)

    vi.doMock('@/lib/supabase/service', () => ({ createServiceClient: () => supabase }))
    vi.doMock('@/lib/email', () => ({ sendWelcomeEmail, sendPaymentGateBlockedEmail }))

    const { POST } = await import('../route')

    const response = await POST(makeRequest(requestBody()))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.paymentUrl).toBeNull()

    // Conta criada de verdade, mesmo sem processadora
    expect(db.organizations ?? []).toHaveLength(1)
    expect(db.units ?? []).toHaveLength(1)
    expect(db.users).toHaveLength(2) // super admin semeado + o novo usuário

    // Notificação informativa pro dono do produto (não bloqueante)
    expect(sendPaymentGateBlockedEmail).toHaveBeenCalledTimes(1)
    expect(sendPaymentGateBlockedEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'dono@alizo.com.br', region: 'BR', plan: 'starter', email: 'maria@padaria.com' }),
    )

    const events = (db.system_events ?? []) as Array<{ event_type: string; level: string }>
    expect(events.some((e) => e.event_type === 'payment_provider_missing' && e.level === 'info')).toBe(true)

    // Registro de cobrança pendente continua sendo criado (financial_records intocado)
    expect(db.financial_records).toHaveLength(1)
    expect((db.financial_records as Array<{ status: string }>)[0]!.status).toBe('pending')

    // Aceite de Termos/Privacidade gravado de forma auditável (migration 066)
    expect(db.legal_acceptances).toHaveLength(1)
    const acceptance = (db.legal_acceptances as Array<Record<string, unknown>>)[0]!
    expect(acceptance).toMatchObject({ org_id: db.organizations![0]!.id, region: 'BR', source: 'checkout' })
    expect(acceptance.terms_version).toBeTruthy()
    expect(acceptance.privacy_version).toBeTruthy()

    expect(sendWelcomeEmail).toHaveBeenCalledTimes(1)
  })

  it('recusa o cadastro quando termsAccepted não é enviado como true', async () => {
    const { supabase, db } = createFakeSupabase({
      users: [{ id: 'admin-1', email: 'dono@alizo.com.br', role: 'super_admin', is_active: true }],
      payment_gateway_settings: [],
    })
    seedAuth(supabase)

    vi.doMock('@/lib/supabase/service', () => ({ createServiceClient: () => supabase }))
    vi.doMock('@/lib/email', () => ({ sendWelcomeEmail, sendPaymentGateBlockedEmail }))

    const { POST } = await import('../route')

    const response = await POST(makeRequest(requestBody({ termsAccepted: false })))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toBeTruthy()
    expect(db.organizations ?? []).toHaveLength(0)
  })

  it('cada região é independente: gateway ativo só no BR não afeta o cadastro dos EUA (segue criando, sem provider)', async () => {
    const { supabase, db } = createFakeSupabase({
      users: [{ id: 'admin-1', email: 'dono@alizo.com.br', role: 'super_admin', is_active: true }],
      payment_gateway_settings: [
        { region: 'BR', provider: 'asaas', credentials: { api_key: 'abc' }, is_active: true },
      ],
    })
    seedAuth(supabase)

    vi.doMock('@/lib/supabase/service', () => ({ createServiceClient: () => supabase }))
    vi.doMock('@/lib/email', () => ({ sendWelcomeEmail, sendPaymentGateBlockedEmail }))

    const { POST } = await import('../route')

    const response = await POST(
      makeRequest(requestBody({ locale: 'en', email: 'john@bakery.com', name: 'John Smith' })),
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(db.organizations ?? []).toHaveLength(1)
    expect(sendPaymentGateBlockedEmail).toHaveBeenCalledWith(expect.objectContaining({ region: 'US' }))
  })

  it('com processadora ativa e credenciais válidas: cria a conta E tenta cobrar de verdade (paymentUrl retornado)', async () => {
    const { supabase, db } = createFakeSupabase({
      users: [{ id: 'admin-1', email: 'dono@alizo.com.br', role: 'super_admin', is_active: true }],
      payment_gateway_settings: [
        { region: 'BR', provider: 'asaas', credentials: { api_key: 'abc' }, is_active: true },
      ],
    })
    seedAuth(supabase)

    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/customers')) {
        return new Response(JSON.stringify({ id: 'cus_123' }), { status: 200 })
      }
      if (String(url).includes('/payments')) {
        return new Response(JSON.stringify({ id: 'pay_123', invoiceUrl: 'https://asaas.com/i/pay_123' }), { status: 200 })
      }
      return new Response('{}', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)

    vi.doMock('@/lib/supabase/service', () => ({ createServiceClient: () => supabase }))
    vi.doMock('@/lib/email', () => ({ sendWelcomeEmail, sendPaymentGateBlockedEmail }))

    const { POST } = await import('../route')

    const response = await POST(makeRequest(requestBody()))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.paymentUrl).toBe('https://asaas.com/i/pay_123')
    expect(db.organizations).toHaveLength(1)
    // Sem processadora "faltando" — não notifica como pendente manual
    expect(sendPaymentGateBlockedEmail).not.toHaveBeenCalled()

    const org = (db.organizations as Array<Record<string, unknown>>)[0]!
    expect(org.billing_provider).toBe('asaas')
    expect(org.billing_provider_subscription_ref).toBe('pay_123')

    vi.unstubAllGlobals()
  })

  it('processadora ativa mas a cobrança falha: a conta continua criada normalmente (falha não desfaz o cadastro)', async () => {
    const { supabase, db } = createFakeSupabase({
      users: [{ id: 'admin-1', email: 'dono@alizo.com.br', role: 'super_admin', is_active: true }],
      payment_gateway_settings: [
        { region: 'BR', provider: 'asaas', credentials: { api_key: 'abc' }, is_active: true },
      ],
    })
    seedAuth(supabase)

    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ errors: [{ description: 'chave inválida' }] }), { status: 401 }))
    vi.stubGlobal('fetch', fetchMock)

    vi.doMock('@/lib/supabase/service', () => ({ createServiceClient: () => supabase }))
    vi.doMock('@/lib/email', () => ({ sendWelcomeEmail, sendPaymentGateBlockedEmail }))

    const { POST } = await import('../route')

    const response = await POST(makeRequest(requestBody()))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.paymentUrl).toBeNull()
    expect(db.organizations).toHaveLength(1)

    const events = (db.system_events ?? []) as Array<{ event_type: string; level: string }>
    expect(events.some((e) => e.event_type === 'payment_charge_failed' && e.level === 'error')).toBe(true)

    vi.unstubAllGlobals()
  })

  it('e-mail já cadastrado: continua recusando (comportamento preexistente, intocado)', async () => {
    const { supabase, db } = createFakeSupabase({
      users: [{ id: 'u-1', email: 'maria@padaria.com', role: 'admin', is_active: true }],
      payment_gateway_settings: [],
    })
    seedAuth(supabase)

    vi.doMock('@/lib/supabase/service', () => ({ createServiceClient: () => supabase }))
    vi.doMock('@/lib/email', () => ({ sendWelcomeEmail, sendPaymentGateBlockedEmail }))

    const { POST } = await import('../route')

    const response = await POST(makeRequest(requestBody()))
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.error).toBeTruthy()
    expect(db.organizations ?? []).toHaveLength(0)
  })
})
