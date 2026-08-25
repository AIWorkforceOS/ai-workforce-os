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

function makeUnit(overrides: Record<string, unknown> = {}) {
  return {
    id: 'unit-1',
    org_id: 'org-1',
    name: 'Mawi Cleaning',
    is_active: true,
    timezone: 'America/Sao_Paulo',
    manager_whatsapp_phone: '5511999998888',
    default_conversation_language: null,
    ...overrides,
  }
}

function authedRequest() {
  return new Request('http://localhost/api/cron/manager-agenda-digest', {
    headers: { authorization: 'Bearer test-secret' },
  })
}

beforeEach(() => {
  vi.resetModules()
  sendWhatsAppMessage.mockClear()
  resolveWhatsappChannel.mockClear()
})

describe('GET /api/cron/manager-agenda-digest', () => {
  it('sem CRON_SECRET correto no header, recusa com 401', async () => {
    vi.doMock('@/lib/supabase/service', () => ({ createServiceClient: () => createFakeSupabase({}).supabase }))
    const { GET } = await import('../route')
    const response = await GET(new Request('http://localhost/api/cron/manager-agenda-digest'))
    expect(response.status).toBe(401)
  })

  it('unidade sem manager_whatsapp_phone não é considerada — nenhuma mensagem enviada', async () => {
    const { supabase } = createFakeSupabase({
      units: [makeUnit({ manager_whatsapp_phone: null })],
    })
    vi.doMock('@/lib/supabase/service', () => ({ createServiceClient: () => supabase }))
    vi.doMock('@/lib/evolution', () => ({ resolveWhatsappChannel, sendWhatsAppMessage }))

    const { GET } = await import('../route')
    const response = await GET(authedRequest())
    const body = await response.json()

    // O fake-supabase de teste não implementa .not(coluna, 'is', null), então
    // a unidade ainda chega ao código (que a descarta corretamente por dentro,
    // ver sendDailyDigestForUnit) — o que importa é confirmar que NENHUMA
    // mensagem foi enviada, não o valor exato de skipped.
    expect(body.sent).toBe(0)
    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
  })

  it('unidade sem agendamento hoje: manda mensagem avisando que a agenda está livre', async () => {
    const { supabase } = createFakeSupabase({
      units: [makeUnit()],
      appointments: [],
    })
    vi.doMock('@/lib/supabase/service', () => ({ createServiceClient: () => supabase }))
    vi.doMock('@/lib/evolution', () => ({ resolveWhatsappChannel, sendWhatsAppMessage }))

    const { GET } = await import('../route')
    const response = await GET(authedRequest())
    const body = await response.json()

    expect(body.sent).toBe(1)
    expect(sendWhatsAppMessage).toHaveBeenCalledTimes(1)
    const [, phone, text] = sendWhatsAppMessage.mock.calls[0]!
    expect(phone).toBe('5511999998888')
    expect(text).toContain('Nenhum agendamento pra hoje')
  })

  it('unidade com agendamentos hoje: lista nome do cliente, horário e serviço na mensagem', async () => {
    const todayNoon = new Date()
    todayNoon.setUTCHours(15, 0, 0, 0) // meio-dia em America/Sao_Paulo (UTC-3)

    const { supabase } = createFakeSupabase({
      units: [makeUnit()],
      appointments: [
        {
          id: 'appt-1',
          unit_id: 'unit-1',
          customer_id: 'cust-1',
          service_id: 'svc-1',
          starts_at: todayNoon.toISOString(),
          status: 'confirmed',
        },
      ],
      customers: [{ id: 'cust-1', name: 'Maria Silva' }],
      services: [{ id: 'svc-1', name: 'Limpeza pesada' }],
    })
    vi.doMock('@/lib/supabase/service', () => ({ createServiceClient: () => supabase }))
    vi.doMock('@/lib/evolution', () => ({ resolveWhatsappChannel, sendWhatsAppMessage }))

    const { GET } = await import('../route')
    const response = await GET(authedRequest())
    const body = await response.json()

    expect(body.sent).toBe(1)
    const [, , text] = sendWhatsAppMessage.mock.calls[0]!
    expect(text).toContain('Maria Silva')
    expect(text).toContain('Limpeza pesada')
    expect(text).toContain('1 agendamento(s)')
  })

  it('sem canal de WhatsApp dedicado da Recepcionista, pula a unidade sem quebrar o cron', async () => {
    const { supabase } = createFakeSupabase({
      units: [makeUnit()],
      appointments: [],
    })
    vi.doMock('@/lib/supabase/service', () => ({ createServiceClient: () => supabase }))
    vi.doMock('@/lib/evolution', () => ({
      resolveWhatsappChannel: vi.fn(async () => null),
      sendWhatsAppMessage,
    }))

    const { GET } = await import('../route')
    const response = await GET(authedRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.skipped).toBe(1)
    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
  })
})
