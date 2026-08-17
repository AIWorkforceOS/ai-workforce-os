import { describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from './fake-supabase'
import type { AgentConfig, Lead, Unit } from '@/lib/types'

// Pedido do dono (2026-08-14): quando um humano de verdade intervém
// manualmente numa conversa (digita direto no WhatsApp conectado), a IA
// não pode continuar respondendo por cima na mesma conversa — trava por
// 40min a partir da última mensagem humana detectada, depois volta ao
// normal sozinho. Este teste cobre o SDR (processInboundMessage); a
// Recepcionista tem cobertura equivalente em
// lib/receptionist/__tests__/engine-guards.test.ts.

const { generateChatReplyMock } = vi.hoisted(() => ({
  generateChatReplyMock: vi.fn(async () => 'ok'),
}))

const sendMessageMock = vi.fn(async () => undefined)

vi.mock('@/lib/channels/messaging-channel', () => ({
  getUnitChannelType: () => 'whatsapp' as const,
  channelLabel: () => 'WhatsApp',
  getMessagingChannel: () => ({ type: 'whatsapp' as const, sendMessage: sendMessageMock }),
  sendToLeadChannels: vi.fn(async () => []),
}))

vi.mock('@/lib/openai', () => ({
  getOpenAIApiKey: () => 'fake-key',
  generateChatReply: generateChatReplyMock,
  generateStructuredReply: vi.fn(async () => ({})),
}))

vi.mock('@/lib/evolution', () => ({
  resolveWhatsappChannel: vi.fn(async () => null),
}))

vi.mock('@/lib/organizations', () => ({
  fetchOrganizationBusinessProfile: vi.fn(async () => null),
}))

vi.mock('@/lib/attachments', () => ({
  fetchActiveAttachments: vi.fn(async () => []),
  buildAttachmentsContext: vi.fn(() => undefined),
}))

function buildUnit(): Unit {
  return {
    id: 'unit-1',
    org_id: 'org-1',
    name: 'Matriz',
    slug: 'matriz',
    whatsapp_instance_id: null,
    whatsapp_phone: '5511999990000',
    email_from: null,
    email_reply_to: null,
    logo_url: null,
    email_accent_color: null,
    email_footer_note: null,
    region_city: 'São Paulo',
    region_state: 'SP',
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
  }
}

function buildLead(unit: Unit): Lead {
  return {
    id: 'lead-human-lock',
    unit_id: unit.id,
    company_name: 'Lead de teste',
    contact_name: 'Cliente',
    phone: '5511988880002',
    email: null,
    sector: null,
    city: null,
    state: null,
    source: 'google_maps',
    status: 'replied',
    google_place_id: null,
    external_lead_id: null,
    enrichment_data: null,
    enriched_at: null,
    notes: null,
    last_contacted_at: new Date().toISOString(),
    deal_profile: {},
    deal_closed_at: null,
    smarter_crm_lead_id: null,
    created_at: '',
    updated_at: '',
  }
}

function buildAgentConfig(unit: Unit): AgentConfig {
  return {
    id: 'cfg-sdr',
    unit_id: unit.id,
    agent_type: 'sdr',
    persona_name: 'Kai',
    persona_tone: 'friendly',
    daily_limit: 50,
    active_hours: { start: '00:00', end: '23:59', days: [0, 1, 2, 3, 4, 5, 6] },
    escalation_rules: { after_messages: 999, keywords: [] },
    sectors: [],
    is_active: true,
    business_profile: { sobre_a_empresa: 'Empresa de teste.' },
    interview_status: 'completed',
    interview_transcript: [],
    created_at: '',
    updated_at: '',
  }
}

describe('processInboundMessage (SDR) — trava de 40min por intervenção humana', () => {
  it('não gera nem envia resposta quando um humano interveio pra este lead há menos de 40min', async () => {
    const unit = buildUnit()
    const lead = buildLead(unit)
    const config = buildAgentConfig(unit)

    const { supabase } = createFakeSupabase({
      agent_configs: [config as unknown as Record<string, unknown>],
      system_events: [
        {
          id: 'evt-human-intervention',
          unit_id: unit.id,
          org_id: unit.org_id,
          event_type: 'human_operator_message',
          level: 'info',
          source: 'system',
          message: 'Intervenção humana manual detectada.',
          metadata: { contact_id: lead.id },
          created_at: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
        },
      ],
    })

    generateChatReplyMock.mockClear()
    sendMessageMock.mockClear()

    const { processInboundMessage } = await import('@/lib/conversation-engine')
    const result = await processInboundMessage({
      supabase,
      unit,
      lead,
      incomingText: 'oi, ainda por aí?',
    })

    expect(result.dealHandoffReady).toBe(false)
    expect(generateChatReplyMock).not.toHaveBeenCalled()
    expect(sendMessageMock).not.toHaveBeenCalled()
  })

  it('volta a responder normalmente depois que a janela de 40min passa', async () => {
    const unit = buildUnit()
    const lead = buildLead(unit)
    const config = buildAgentConfig(unit)

    const { supabase } = createFakeSupabase({
      agent_configs: [config as unknown as Record<string, unknown>],
      system_events: [
        {
          id: 'evt-human-intervention-old',
          unit_id: unit.id,
          org_id: unit.org_id,
          event_type: 'human_operator_message',
          level: 'info',
          source: 'system',
          message: 'Intervenção humana manual detectada.',
          metadata: { contact_id: lead.id },
          created_at: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
        },
      ],
    })

    generateChatReplyMock.mockClear()
    sendMessageMock.mockClear()

    const { processInboundMessage } = await import('@/lib/conversation-engine')
    await processInboundMessage({
      supabase,
      unit,
      lead,
      incomingText: 'oi, ainda por aí?',
    })

    expect(generateChatReplyMock).toHaveBeenCalledTimes(1)
    expect(sendMessageMock).toHaveBeenCalledTimes(1)
  })
})
