import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'

process.env.CRON_SECRET = 'test-secret'

const sendWhatsAppMessage = vi.fn(async (_config: unknown, _phone: string, _text: string) => ({ ok: true }))
const resolveWhatsappChannel = vi.fn(async () => ({
  agentType: 'receptionist',
  config: { apiUrl: 'https://fake-evolution.test', apiKey: 'fake', instanceName: 'receptionist-instance' },
  whatsappPhone: '5511988887777',
  persistPhone: vi.fn(async () => {}),
}))
const generateChatReply = vi.fn(async () => 'Oi! Passando pra saber como foi tudo :)')

function makeUnit(overrides: Record<string, unknown> = {}) {
  return {
    id: 'unit-1',
    org_id: 'org-1',
    name: 'Mawi Cleaning',
    is_active: true,
    timezone: 'America/Sao_Paulo',
    default_conversation_language: null,
    ...overrides,
  }
}

function makeReceptionistConfig(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cfg-rec-1',
    unit_id: 'unit-1',
    agent_type: 'receptionist',
    persona_name: 'Bia',
    persona_tone: 'friendly',
    is_active: true,
    business_profile: {},
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
}

function authedRequest() {
  return new Request('http://localhost/api/cron/receptionist-care', {
    headers: { authorization: 'Bearer test-secret' },
  })
}

async function loadRoute(supabase: unknown) {
  vi.doMock('@/lib/supabase/service', () => ({ createServiceClient: () => supabase }))
  vi.doMock('@/lib/evolution', () => ({ resolveWhatsappChannel, sendWhatsAppMessage }))
  vi.doMock('@/lib/openai', () => ({ getOpenAIApiKey: () => 'fake-key', generateChatReply }))
  return import('../route')
}

beforeEach(() => {
  vi.resetModules()
  sendWhatsAppMessage.mockClear()
  resolveWhatsappChannel.mockClear()
  generateChatReply.mockClear()
})

describe('GET /api/cron/receptionist-care', () => {
  it('sem CRON_SECRET correto no header, recusa com 401', async () => {
    const { GET } = await loadRoute(createFakeSupabase({}).supabase)
    const response = await GET(new Request('http://localhost/api/cron/receptionist-care'))
    expect(response.status).toBe(401)
  })

  it('unidade sem Recepcionista ativa: nenhuma mensagem enviada', async () => {
    const { supabase } = createFakeSupabase({
      units: [makeUnit()],
      organizations: [{ id: 'org-1', billing_status: 'active', business_profile: {} }],
      agent_configs: [],
    })
    const { GET } = await loadRoute(supabase)

    const response = await GET(authedRequest())
    const body = await response.json()

    expect(body).toMatchObject({ ok: true, checkinsSent: 0, winbacksSent: 0 })
    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
  })

  it('org com cobrança bloqueada (past_due): pula a unidade inteira, sem tentar nada', async () => {
    const { supabase } = createFakeSupabase({
      units: [makeUnit()],
      organizations: [{ id: 'org-1', billing_status: 'past_due', business_profile: {} }],
      agent_configs: [makeReceptionistConfig()],
      customers: [{ id: 'cust-1', unit_id: 'unit-1', name: 'Maria', phone: '5511999990000', status: 'active', marketing_opt_out: false }],
      appointments: [
        { id: 'appt-1', unit_id: 'unit-1', customer_id: 'cust-1', service_id: null, status: 'completed', starts_at: daysAgoIso(1) },
      ],
    })
    const { GET } = await loadRoute(supabase)

    const response = await GET(authedRequest())
    const body = await response.json()

    expect(body).toMatchObject({ checkinsSent: 0, winbacksSent: 0 })
    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
  })

  it('serviço concluído ontem: manda check-in de satisfação pro cliente', async () => {
    const { supabase, db } = createFakeSupabase({
      units: [makeUnit()],
      organizations: [{ id: 'org-1', billing_status: 'active', business_profile: {} }],
      agent_configs: [makeReceptionistConfig()],
      customers: [{ id: 'cust-1', unit_id: 'unit-1', name: 'Maria', phone: '5511999990000', status: 'active', marketing_opt_out: false }],
      appointments: [
        { id: 'appt-1', unit_id: 'unit-1', customer_id: 'cust-1', service_id: null, status: 'completed', starts_at: daysAgoIso(1) },
      ],
    })
    const { GET } = await loadRoute(supabase)

    const response = await GET(authedRequest())
    const body = await response.json()

    expect(body.checkinsSent).toBe(1)
    expect(sendWhatsAppMessage).toHaveBeenCalledWith(expect.anything(), '5511999990000', expect.any(String))
    const events = (db.system_events ?? []) as Array<{ event_type: string }>
    expect(events.some((e) => e.event_type === 'receptionist_post_service_checkin_sent')).toBe(true)
  })

  it('serviço concluído há 5 dias (fora da janela de "ontem"): não manda check-in', async () => {
    const { supabase } = createFakeSupabase({
      units: [makeUnit()],
      organizations: [{ id: 'org-1', billing_status: 'active', business_profile: {} }],
      agent_configs: [makeReceptionistConfig()],
      customers: [{ id: 'cust-1', unit_id: 'unit-1', name: 'Maria', phone: '5511999990000', status: 'active', marketing_opt_out: false }],
      appointments: [
        { id: 'appt-1', unit_id: 'unit-1', customer_id: 'cust-1', service_id: null, status: 'completed', starts_at: daysAgoIso(5) },
      ],
    })
    const { GET } = await loadRoute(supabase)

    const response = await GET(authedRequest())
    const body = await response.json()

    expect(body.checkinsSent).toBe(0)
  })

  it('cliente sem serviço há mais de 60 dias: manda mensagem de retorno (winback)', async () => {
    const { supabase, db } = createFakeSupabase({
      units: [makeUnit()],
      organizations: [{ id: 'org-1', billing_status: 'active', business_profile: {} }],
      agent_configs: [makeReceptionistConfig()],
      customers: [{ id: 'cust-1', unit_id: 'unit-1', name: 'Maria', phone: '5511999990000', status: 'active', marketing_opt_out: false }],
      appointments: [
        { id: 'appt-1', unit_id: 'unit-1', customer_id: 'cust-1', service_id: null, status: 'completed', starts_at: daysAgoIso(90) },
      ],
    })
    const { GET } = await loadRoute(supabase)

    const response = await GET(authedRequest())
    const body = await response.json()

    expect(body.winbacksSent).toBe(1)
    const events = (db.system_events ?? []) as Array<{ event_type: string }>
    expect(events.some((e) => e.event_type === 'receptionist_winback_sent')).toBe(true)
  })

  it('cliente já recebeu winback há 10 dias: não manda de novo (cooldown de 30 dias)', async () => {
    const { supabase } = createFakeSupabase({
      units: [makeUnit()],
      organizations: [{ id: 'org-1', billing_status: 'active', business_profile: {} }],
      agent_configs: [makeReceptionistConfig()],
      customers: [{ id: 'cust-1', unit_id: 'unit-1', name: 'Maria', phone: '5511999990000', status: 'active', marketing_opt_out: false }],
      appointments: [
        { id: 'appt-1', unit_id: 'unit-1', customer_id: 'cust-1', service_id: null, status: 'completed', starts_at: daysAgoIso(90) },
      ],
      system_events: [
        {
          id: 'evt-1',
          event_type: 'receptionist_winback_sent',
          unit_id: 'unit-1',
          metadata: { contact_id: 'cust-1' },
          created_at: daysAgoIso(10),
        },
      ],
    })
    const { GET } = await loadRoute(supabase)

    const response = await GET(authedRequest())
    const body = await response.json()

    expect(body.winbacksSent).toBe(0)
  })

  it('cliente com marketing_opt_out=true: nunca recebe winback', async () => {
    const { supabase } = createFakeSupabase({
      units: [makeUnit()],
      organizations: [{ id: 'org-1', billing_status: 'active', business_profile: {} }],
      agent_configs: [makeReceptionistConfig()],
      customers: [{ id: 'cust-1', unit_id: 'unit-1', name: 'Maria', phone: '5511999990000', status: 'active', marketing_opt_out: true }],
      appointments: [
        { id: 'appt-1', unit_id: 'unit-1', customer_id: 'cust-1', service_id: null, status: 'completed', starts_at: daysAgoIso(90) },
      ],
    })
    const { GET } = await loadRoute(supabase)

    const response = await GET(authedRequest())
    const body = await response.json()

    expect(body.winbacksSent).toBe(0)
  })

  it('cliente nunca teve serviço concluído: não é elegível a winback (nunca foi cliente ativo de verdade)', async () => {
    const { supabase } = createFakeSupabase({
      units: [makeUnit()],
      organizations: [{ id: 'org-1', billing_status: 'active', business_profile: {} }],
      agent_configs: [makeReceptionistConfig()],
      customers: [{ id: 'cust-1', unit_id: 'unit-1', name: 'Maria', phone: '5511999990000', status: 'active', marketing_opt_out: false }],
      appointments: [],
    })
    const { GET } = await loadRoute(supabase)

    const response = await GET(authedRequest())
    const body = await response.json()

    expect(body.winbacksSent).toBe(0)
  })
})
