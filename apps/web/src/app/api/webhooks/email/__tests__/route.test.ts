import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'
import type { Unit } from '@/lib/types'

// Cobre as correções da auditoria P0.2 (19/08/2026): (1) bounce/complaint do
// Resend não é mais silenciosamente descartado — vira system_event visível;
// (2) o unitId extraído do plus-addressing (reply+{unitId}@dominio) é
// validado como UUID antes de consultar o banco. O resto do handler
// (assinatura Svix, roteamento pro inbound-router) já tinha comportamento
// coberto indiretamente por lib/__tests__/inbound-router-idempotency.test.ts
// — aqui focamos só no que mudou.

const routeInboundMessage = vi.fn(async () => ({ ok: true }))

function buildUnit(overrides: Partial<Unit> = {}): Unit {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    org_id: 'org-1',
    name: 'Unidade Teste',
    slug: 'unidade-teste',
    whatsapp_instance_id: null,
    whatsapp_phone: null,
    email_from: null,
    email_reply_to: null,
    logo_url: null,
    email_accent_color: null,
    email_footer_note: null,
    region_city: null,
    region_state: null,
    evolution_api_url: null,
    evolution_api_key: null,
    evolution_instance_name: null,
    messaging_channel: null,
    twilio_account_sid: null,
    twilio_auth_token: null,
    twilio_phone_number: null,
    default_conversation_language: null,
    intake_token: null,
    crm_integration_mode: 'native',
    smarter_crm_partner_token: null,
    recruiting_integration_mode: 'native',
    smarter_recruiting_partner_token: null,
    smarter_recruiting_company_id: null,
    smarter_marketing_partner_token: null,
    public_lead_intake_token: null,
    timezone: 'America/Sao_Paulo',
    business_hours: {},
    scheduling_settings: {},
    billing_company_name: null,
    billing_address: null,
    billing_email: null,
    billing_phone: null,
    billing_payment_instructions: null,
    is_active: true,
    created_at: '',
    updated_at: '',
    ...overrides,
  } as Unit
}

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/webhooks/email', { method: 'POST', body: JSON.stringify(body) })
}

describe('POST /api/webhooks/email', () => {
  const originalInboundDomain = process.env.EMAIL_INBOUND_DOMAIN
  const originalWebhookSecret = process.env.RESEND_WEBHOOK_SECRET

  beforeEach(() => {
    vi.resetModules()
    routeInboundMessage.mockClear()
    process.env.EMAIL_INBOUND_DOMAIN = 'inbound.alizoai.com'
    delete process.env.RESEND_WEBHOOK_SECRET // caminho tolerante — já coberto/documentado; foco aqui é nas outras correções
  })

  afterEach(() => {
    process.env.EMAIL_INBOUND_DOMAIN = originalInboundDomain
    process.env.RESEND_WEBHOOK_SECRET = originalWebhookSecret
  })

  it('email.bounced: loga system_event e não chama o roteador de mensagens', async () => {
    const { supabase, db } = createFakeSupabase({ units: [buildUnit()] })
    vi.doMock('@/lib/supabase/service', () => ({ createServiceClient: () => supabase }))
    vi.doMock('@/lib/inbound-router', () => ({ routeInboundMessage }))
    vi.doMock('@/lib/email', () => ({ getResendApiKey: () => 'fake-key' }))

    const { POST } = await import('../route')

    const response = await POST(
      makeRequest({ type: 'email.bounced', data: { to: ['lead@empresa.com'], email_id: 'em_1' } }),
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.logged).toBe('email.bounced')
    expect(routeInboundMessage).not.toHaveBeenCalled()

    const events = (db.system_events ?? []) as Array<{ event_type: string; level: string }>
    expect(events.some((e) => e.event_type === 'email_bounced' && e.level === 'warning')).toBe(true)
  })

  it('email.complained: loga system_event distinto e não chama o roteador', async () => {
    const { supabase, db } = createFakeSupabase({ units: [buildUnit()] })
    vi.doMock('@/lib/supabase/service', () => ({ createServiceClient: () => supabase }))
    vi.doMock('@/lib/inbound-router', () => ({ routeInboundMessage }))
    vi.doMock('@/lib/email', () => ({ getResendApiKey: () => 'fake-key' }))

    const { POST } = await import('../route')

    const response = await POST(makeRequest({ type: 'email.complained', data: { to: ['lead@empresa.com'] } }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.logged).toBe('email.complained')
    const events = (db.system_events ?? []) as Array<{ event_type: string }>
    expect(events.some((e) => e.event_type === 'email_complained')).toBe(true)
  })

  it('rejeita (skip) unitId extraído do plus-addressing que não é um UUID válido', async () => {
    const { supabase } = createFakeSupabase({ units: [buildUnit()] })
    vi.doMock('@/lib/supabase/service', () => ({ createServiceClient: () => supabase }))
    vi.doMock('@/lib/inbound-router', () => ({ routeInboundMessage }))
    vi.doMock('@/lib/email', () => ({ getResendApiKey: () => 'fake-key' }))

    const { POST } = await import('../route')

    const response = await POST(
      makeRequest({
        type: 'email.received',
        data: {
          email_id: 'em_1',
          from: 'lead@empresa.com',
          to: ["reply+'; DROP TABLE units;--@inbound.alizoai.com"],
        },
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.skipped).toBe('unit_not_resolved')
    expect(routeInboundMessage).not.toHaveBeenCalled()
  })

  it('email.received com unitId válido resolve a unidade e chama o roteador', async () => {
    const unit = buildUnit()
    const { supabase } = createFakeSupabase({ units: [unit] })
    vi.doMock('@/lib/supabase/service', () => ({ createServiceClient: () => supabase }))
    vi.doMock('@/lib/inbound-router', () => ({ routeInboundMessage }))
    vi.doMock('@/lib/email', () => ({ getResendApiKey: () => 'fake-key' }))

    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ text: 'Oi, tenho interesse!' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await import('../route')

    const response = await POST(
      makeRequest({
        type: 'email.received',
        data: { email_id: 'em_2', from: 'lead@empresa.com', to: [`reply+${unit.id}@inbound.alizoai.com`] },
      }),
    )

    expect(response.status).toBe(200)
    expect(routeInboundMessage).toHaveBeenCalledTimes(1)
    expect(routeInboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'email', incomingEmail: 'lead@empresa.com', text: 'Oi, tenho interesse!' }),
    )

    vi.unstubAllGlobals()
  })
})
