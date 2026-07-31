import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'

// Testa o handler HTTP de verdade (route.ts): sem processadora ativa pra
// região do comprador, a conta NÃO pode ser criada — o cliente recebe a
// orientação de falar com o suporte e a Alizo é notificada na hora (e-mail +
// system_events). Assim que uma processadora fica ativa, o checkout volta a
// criar a conta normalmente sem qualquer mudança de código.

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
    ...overrides,
  }
}

function makeRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/checkout/complete', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

describe('POST /api/checkout/complete — trava de compra sem processadora ativa', () => {
  beforeEach(() => {
    vi.resetModules()
    sendWelcomeEmail.mockClear()
    sendPaymentGateBlockedEmail.mockClear()
  })

  it('bloqueia o cadastro, não cria organização/usuário, notifica os super admins e registra system_event', async () => {
    const { supabase, db } = createFakeSupabase({
      users: [{ id: 'admin-1', email: 'dono@alizo.com.br', role: 'super_admin', is_active: true }],
      payment_gateway_settings: [],
    })

    vi.doMock('@/lib/supabase/service', () => ({ createServiceClient: () => supabase }))
    vi.doMock('@/lib/email', () => ({ sendWelcomeEmail, sendPaymentGateBlockedEmail }))

    const { POST } = await import('../route')

    const response = await POST(makeRequest(requestBody()))
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body.error).toContain('suporte@alizo.com.br')

    // Nenhuma conta foi criada
    expect(db.organizations ?? []).toHaveLength(0)
    expect(db.units ?? []).toHaveLength(0)
    expect(db.users).toHaveLength(1) // só o super admin semeado, ninguém novo

    // Notificação imediata pro dono do produto
    expect(sendPaymentGateBlockedEmail).toHaveBeenCalledTimes(1)
    expect(sendPaymentGateBlockedEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'dono@alizo.com.br',
        region: 'BR',
        plan: 'starter',
        name: 'Maria Silva',
        email: 'maria@padaria.com',
        phone: '+55 11 99999-0000',
      }),
    )

    // Rastreável no admin
    const events = db.system_events ?? []
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      level: 'warning',
      source: 'checkout',
      event_type: 'payment_gate_blocked',
    })
    expect(events[0]!.metadata).toMatchObject({ region: 'BR', plan: 'starter', email: 'maria@padaria.com' })

    // E-mail de boas-vindas não é disparado — o cadastro nunca aconteceu
    expect(sendWelcomeEmail).not.toHaveBeenCalled()
  })

  it('cada região tem sua própria checagem: gateway ativo só no BR não libera o checkout dos EUA', async () => {
    const { supabase, db } = createFakeSupabase({
      users: [{ id: 'admin-1', email: 'dono@alizo.com.br', role: 'super_admin', is_active: true }],
      payment_gateway_settings: [
        { region: 'BR', provider: 'asaas', credentials: { api_key: 'abc' }, is_active: true },
      ],
    })

    vi.doMock('@/lib/supabase/service', () => ({ createServiceClient: () => supabase }))
    vi.doMock('@/lib/email', () => ({ sendWelcomeEmail, sendPaymentGateBlockedEmail }))

    const { POST } = await import('../route')

    const response = await POST(
      makeRequest(requestBody({ locale: 'en', email: 'john@bakery.com', name: 'John Smith' })),
    )
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body.error).toContain('suporte@alizo.com.br')
    expect(db.organizations ?? []).toHaveLength(0)
    expect(sendPaymentGateBlockedEmail).toHaveBeenCalledWith(expect.objectContaining({ region: 'US' }))
  })

  it('com processadora ativa e com credenciais pra região, o checkout cria a conta normalmente', async () => {
    const { supabase, db } = createFakeSupabase({
      users: [{ id: 'admin-1', email: 'dono@alizo.com.br', role: 'super_admin', is_active: true }],
      payment_gateway_settings: [
        { region: 'BR', provider: 'asaas', credentials: { api_key: 'abc' }, is_active: true },
      ],
    })
    Object.assign(supabase, {
      auth: { admin: { createUser: vi.fn(async () => ({ data: { user: { id: 'auth-1' } }, error: null })) } },
    })

    vi.doMock('@/lib/supabase/service', () => ({ createServiceClient: () => supabase }))
    vi.doMock('@/lib/email', () => ({ sendWelcomeEmail, sendPaymentGateBlockedEmail }))

    const { POST } = await import('../route')

    const response = await POST(makeRequest(requestBody()))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(db.organizations).toHaveLength(1)
    expect(db.units).toHaveLength(1)
    expect(sendPaymentGateBlockedEmail).not.toHaveBeenCalled()
    expect(sendWelcomeEmail).toHaveBeenCalledTimes(1)
  })
})
