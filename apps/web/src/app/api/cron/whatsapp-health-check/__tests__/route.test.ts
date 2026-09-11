import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'

process.env.CRON_SECRET = 'test-secret'

// Verificação diária de saúde do WhatsApp (pedido do Vinicius, 2026-09-08):
// achado real — o WhatsApp da unidade "Smarter Matriz" caiu e ficou 4 dias
// sem receber NENHUMA mensagem, sem ninguém perceber. "O cliente não vai
// saber o que aconteceu e como resolver" — esse cron detecta e avisa por
// e-mail (nunca por WhatsApp, é o canal que está fora do ar).

const getInstanceStatus = vi.fn()
const getEvolutionConfig = vi.fn((unit: { id: string }, instanceNameOverride?: string) => ({
  apiUrl: 'https://evolution.example.com',
  apiKey: 'key',
  instanceName: instanceNameOverride ?? `unit-${unit.id}`,
}))
const legacyWhatsappChannel = vi.fn((_supabase: unknown, unit: { id: string }) => ({
  agentType: null,
  config: { apiUrl: 'https://evolution.example.com', apiKey: 'key', instanceName: `unit-${unit.id}` },
  whatsappPhone: '5521999999999',
  persistPhone: async () => {},
}))
const sendWhatsappDisconnectedEmail = vi.fn(async () => ({ ok: true }))

function makeUnitRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'unit-1',
    org_id: 'org-1',
    name: 'Smarter Matriz',
    is_active: true,
    whatsapp_phone: '5521999999999',
    slug: 'smarter-matriz',
    ...overrides,
  }
}

async function loadRoute(supabase: unknown) {
  vi.doMock('@/lib/supabase/service', () => ({ createServiceClient: () => supabase }))
  vi.doMock('@/lib/evolution', () => ({ getEvolutionConfig, getInstanceStatus, legacyWhatsappChannel }))
  vi.doMock('@/lib/email', () => ({ sendWhatsappDisconnectedEmail }))
  return import('../route')
}

function makeRequest() {
  return new Request('http://localhost/api/cron/whatsapp-health-check', {
    headers: { authorization: 'Bearer test-secret' },
  })
}

describe('GET /api/cron/whatsapp-health-check', () => {
  beforeEach(() => {
    vi.resetModules()
    getInstanceStatus.mockReset()
    sendWhatsappDisconnectedEmail.mockClear()
    sendWhatsappDisconnectedEmail.mockResolvedValue({ ok: true })
  })

  it('401 sem o header de autorização correto', async () => {
    const { supabase } = createFakeSupabase({ units: [makeUnitRow()] })
    const { GET } = await loadRoute(supabase)
    const res = await GET(new Request('http://localhost/api/cron/whatsapp-health-check'))
    expect(res.status).toBe(401)
  })

  it('WhatsApp conectado (open): não manda aviso nenhum', async () => {
    getInstanceStatus.mockResolvedValue('open')
    const { supabase, db } = createFakeSupabase({
      units: [makeUnitRow()],
      organizations: [{ id: 'org-1', owner_email: 'dono@smarter.com' }],
    })
    const { GET } = await loadRoute(supabase)

    const res = await GET(makeRequest())
    const body = await res.json()

    expect(body).toEqual({ ok: true, checked: 1, disconnected: 0, alertsSent: 0, errors: 0 })
    expect(sendWhatsappDisconnectedEmail).not.toHaveBeenCalled()
    expect(db.system_events?.some((e) => e.event_type === 'whatsapp_disconnected_alert_sent')).toBe(false)
  })

  it('WhatsApp desconectado (close): manda o e-mail pro dono da unidade e loga o alerta', async () => {
    getInstanceStatus.mockResolvedValue('close')
    const { supabase, db } = createFakeSupabase({
      units: [makeUnitRow()],
      organizations: [{ id: 'org-1', owner_email: 'dono@smarter.com' }],
    })
    const { GET } = await loadRoute(supabase)

    const res = await GET(makeRequest())
    const body = await res.json()

    expect(body).toEqual({ ok: true, checked: 1, disconnected: 1, alertsSent: 1, errors: 0 })
    expect(sendWhatsappDisconnectedEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'dono@smarter.com', unitName: 'Smarter Matriz', agentLabel: null }),
    )
    expect(db.system_events?.some((e) => e.event_type === 'whatsapp_disconnected_alert_sent')).toBe(true)
  })

  it('não manda 2 avisos no mesmo dia — cooldown por (unidade, canal)', async () => {
    getInstanceStatus.mockResolvedValue('close')
    const { supabase, db } = createFakeSupabase({
      units: [makeUnitRow()],
      organizations: [{ id: 'org-1', owner_email: 'dono@smarter.com' }],
      system_events: [
        {
          id: 'evt-1',
          unit_id: 'unit-1',
          event_type: 'whatsapp_disconnected_alert_sent',
          metadata: { agentType: null },
          created_at: new Date().toISOString(),
        },
      ],
    })
    const { GET } = await loadRoute(supabase)

    const res = await GET(makeRequest())
    const body = await res.json()

    expect(body).toEqual({ ok: true, checked: 1, disconnected: 1, alertsSent: 0, errors: 0 })
    expect(sendWhatsappDisconnectedEmail).not.toHaveBeenCalled()
    expect(db.system_events).toHaveLength(2) // o antigo + o run summary, nenhum alert_sent novo
  })

  it('canal dedicado (unit_whatsapp_channels) desconectado usa o rótulo do funcionário no e-mail', async () => {
    getInstanceStatus.mockResolvedValue('close')
    const { supabase } = createFakeSupabase({
      units: [makeUnitRow({ whatsapp_phone: null })],
      unit_whatsapp_channels: [{ unit_id: 'unit-1', agent_type: 'receptionist', evolution_instance_name: 'unit-1-receptionist' }],
      organizations: [{ id: 'org-1', owner_email: 'dono@smarter.com' }],
    })
    const { GET } = await loadRoute(supabase)

    const res = await GET(makeRequest())
    const body = await res.json()

    expect(body).toEqual({ ok: true, checked: 1, disconnected: 1, alertsSent: 1, errors: 0 })
    expect(sendWhatsappDisconnectedEmail).toHaveBeenCalledWith(expect.objectContaining({ agentLabel: 'Recepcionista' }))
  })

  it('unidade sem WhatsApp configurado nunca — não checa nada (não é desconexão, nunca conectou)', async () => {
    getInstanceStatus.mockResolvedValue('close')
    const { supabase } = createFakeSupabase({
      units: [makeUnitRow({ whatsapp_phone: null })],
      organizations: [{ id: 'org-1', owner_email: 'dono@smarter.com' }],
    })
    const { GET } = await loadRoute(supabase)

    const res = await GET(makeRequest())
    const body = await res.json()

    expect(body).toEqual({ ok: true, checked: 0, disconnected: 0, alertsSent: 0, errors: 0 })
    expect(sendWhatsappDisconnectedEmail).not.toHaveBeenCalled()
  })

  it('sem owner_email cadastrado: não manda e-mail, mas registra que faltou', async () => {
    getInstanceStatus.mockResolvedValue('close')
    const { supabase, db } = createFakeSupabase({
      units: [makeUnitRow()],
      organizations: [{ id: 'org-1', owner_email: null }],
    })
    const { GET } = await loadRoute(supabase)

    const res = await GET(makeRequest())
    const body = await res.json()

    expect(body).toEqual({ ok: true, checked: 1, disconnected: 1, alertsSent: 0, errors: 0 })
    expect(sendWhatsappDisconnectedEmail).not.toHaveBeenCalled()
    expect(db.system_events?.some((e) => e.event_type === 'whatsapp_health_check_no_owner_email')).toBe(true)
  })

  it('erro ao checar status conta como erro e não derruba o cron inteiro', async () => {
    getInstanceStatus.mockRejectedValue(new Error('Evolution API fora do ar'))
    const { supabase, db } = createFakeSupabase({
      units: [makeUnitRow()],
      organizations: [{ id: 'org-1', owner_email: 'dono@smarter.com' }],
    })
    const { GET } = await loadRoute(supabase)

    const res = await GET(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ ok: true, checked: 1, disconnected: 0, alertsSent: 0, errors: 1 })
    expect(db.system_events?.some((e) => e.event_type === 'whatsapp_health_check_status_failed')).toBe(true)
  })
})
