import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'
import type { Lead, Unit } from '@/lib/types'

// Achado P1.3 da auditoria de 18-19/08/2026: sendAcrossChannels não lança
// quando todos os canais falham (Evolution API recusou etc.) — o cron de
// follow-up só dava `continue` silencioso, sem nenhum rastro em
// system_events. Cobre que a falha agora fica visível (mesma classe de
// gap corrigida em lib/leads/lead-intake.ts triggerFirstContact).

process.env.CRON_SECRET = 'test-secret'

const getMessagingChannel = vi.fn(() => ({ type: 'whatsapp', sendMessage: vi.fn() }))
const getEmailChannel = vi.fn(() => null)
const getOpenAIApiKey = vi.fn(() => 'fake-key')
const countSentToday = vi.fn(async () => 0)
const isWithinActiveHours = vi.fn(() => true)
const generateFollowUpMessage = vi.fn(async () => 'Oi, tudo bem? Ainda tem interesse?')
const sendAcrossChannels = vi.fn(
  async () => ({ anySent: false, attempts: [{ channel: 'whatsapp', ok: false, error: 'Número inválido' }] }) as {
    anySent: boolean
    attempts: { channel: string; ok: boolean; error?: string }[]
  },
)

function makeUnitRow(overrides: Partial<Unit> = {}): Record<string, unknown> {
  return { id: 'unit-1', org_id: 'org-1', name: 'Unidade Central', is_active: true, ...overrides }
}

function makeConfigRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cfg-1',
    unit_id: 'unit-1',
    agent_type: 'sdr',
    persona_name: 'Kai',
    is_active: true,
    active_hours: {},
    daily_limit: 50,
    ...overrides,
  }
}

function makeLeadRow(overrides: Partial<Lead> = {}): Record<string, unknown> {
  return {
    id: 'lead-1',
    unit_id: 'unit-1',
    company_name: 'Padaria da Esquina',
    phone: '5511988888888',
    email: null,
    status: 'contacted',
    last_contacted_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
    ...overrides,
  }
}

beforeEach(() => {
  vi.resetModules()
  getMessagingChannel.mockClear()
  getEmailChannel.mockClear()
  getOpenAIApiKey.mockClear().mockReturnValue('fake-key')
  countSentToday.mockClear().mockResolvedValue(0)
  isWithinActiveHours.mockClear().mockReturnValue(true)
  generateFollowUpMessage.mockClear().mockResolvedValue('Oi, tudo bem? Ainda tem interesse?')
  sendAcrossChannels.mockClear()
})

describe('GET /api/cron/follow-up — observabilidade de falha de canal (P1.3)', () => {
  it('registra system_event quando o follow-up falha em todos os canais, em vez de sumir em silêncio', async () => {
    sendAcrossChannels.mockResolvedValue({
      anySent: false,
      attempts: [{ channel: 'whatsapp', ok: false, error: 'Número inválido' }],
    })

    const { supabase, db } = createFakeSupabase({
      agent_configs: [makeConfigRow()],
      units: [makeUnitRow()],
      leads: [makeLeadRow()],
      conversations: [],
    })

    vi.doMock('@/lib/supabase/service', () => ({ createServiceClient: () => supabase }))
    vi.doMock('@/lib/channels/messaging-channel', () => ({ getMessagingChannel, getEmailChannel }))
    vi.doMock('@/lib/openai', () => ({ getOpenAIApiKey }))
    vi.doMock('@/lib/conversation-engine', () => ({
      countSentToday,
      generateFollowUpMessage,
      isWithinActiveHours,
      sendAcrossChannels,
    }))

    const { GET } = await import('../route')
    const response = await GET(new Request('http://test/api/cron/follow-up', { headers: { authorization: 'Bearer test-secret' } }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.sent).toBe(0)
    expect(body.errors).toBe(1)

    const events = (db.system_events ?? []) as Array<{ event_type: string; level: string; lead_id: string | null }>
    const failure = events.find((e) => e.event_type === 'follow_up_channel_failed')
    expect(failure).toBeDefined()
    expect(failure?.level).toBe('warning')
    expect(failure?.lead_id).toBe('lead-1')

    // lead NÃO deve ter last_contacted_at atualizado — o follow-up de fato não saiu
    const leadRow = db.leads?.[0] as Record<string, unknown>
    expect(leadRow.last_contacted_at).not.toBe(undefined)
  })

  it('não gera evento de falha quando o envio dá certo', async () => {
    sendAcrossChannels.mockResolvedValue({ anySent: true, attempts: [{ channel: 'whatsapp', ok: true }] })

    const { supabase, db } = createFakeSupabase({
      agent_configs: [makeConfigRow()],
      units: [makeUnitRow()],
      leads: [makeLeadRow()],
      conversations: [],
    })

    vi.doMock('@/lib/supabase/service', () => ({ createServiceClient: () => supabase }))
    vi.doMock('@/lib/channels/messaging-channel', () => ({ getMessagingChannel, getEmailChannel }))
    vi.doMock('@/lib/openai', () => ({ getOpenAIApiKey }))
    vi.doMock('@/lib/conversation-engine', () => ({
      countSentToday,
      generateFollowUpMessage,
      isWithinActiveHours,
      sendAcrossChannels,
    }))

    const { GET } = await import('../route')
    const response = await GET(new Request('http://test/api/cron/follow-up', { headers: { authorization: 'Bearer test-secret' } }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.sent).toBe(1)
    expect(body.errors).toBe(0)

    const events = (db.system_events ?? []) as Array<{ event_type: string }>
    expect(events.some((e) => e.event_type === 'follow_up_channel_failed')).toBe(false)
  })
})
