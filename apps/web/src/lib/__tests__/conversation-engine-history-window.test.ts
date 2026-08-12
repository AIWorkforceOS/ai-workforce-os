import { describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from './fake-supabase'
import type { AgentConfig, Lead, Unit } from '@/lib/types'

// Regressão (2026-08-11): a mesma correção aplicada em fetchCustomerHistory
// (lib/receptionist/engine.ts, commit b0b6ac9) valia também aqui — o
// histórico da conversa era buscado com `.order('sent_at', { ascending: true
// }).limit(20)`, o que devolve as 20 mensagens MAIS ANTIGAS de uma conversa
// longa, não as mais recentes. Numa conversa com mais de 20 mensagens, a
// pergunta atual do lead ficava fora da janela enviada ao modelo. Este teste
// garante que, com mais de 20 mensagens salvas, o histórico passado ao LLM
// contém as mensagens recentes (não as antigas) e mantém ordem cronológica.

const { generateChatReplyMock } = vi.hoisted(() => ({
  generateChatReplyMock: vi.fn(async (_params: { history: { role: string; content: string }[] }) => 'ok'),
}))

vi.mock('@/lib/channels/messaging-channel', () => ({
  getUnitChannelType: () => 'whatsapp' as const,
  channelLabel: () => 'WhatsApp',
  getMessagingChannel: () => ({ type: 'whatsapp' as const, sendMessage: vi.fn(async () => undefined) }),
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
    id: 'lead-history-window',
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
    business_profile: {
      sobre_a_empresa: 'Empresa de teste.',
    },
    interview_status: 'completed',
    interview_transcript: [],
    created_at: '',
    updated_at: '',
  }
}

describe('processInboundMessage — janela de histórico (regressão ascending+limit)', () => {
  it('inclui as mensagens RECENTES (não as mais antigas) quando a conversa passa de 20 mensagens', async () => {
    const unit = buildUnit()
    const lead = buildLead(unit)
    const config = buildAgentConfig(unit)

    // 30 mensagens antigas, cronologicamente as primeiras da conversa —
    // nenhuma delas deve sobreviver à janela de 20 mais recentes.
    const oldMessages = Array.from({ length: 30 }, (_, i) => ({
      id: `conv-old-${i}`,
      lead_id: lead.id,
      unit_id: unit.id,
      channel: 'whatsapp',
      direction: i % 2 === 0 ? 'inbound' : 'outbound',
      content: `mensagem antiga #${i}`,
      status: 'sent',
      sent_at: new Date(2026, 0, 1, 0, i).toISOString(),
      template_key: null,
    }))

    // 20 mensagens recentes: a busca no banco tem limit(20) por si só,
    // ANTES de somar o incomingText desta chamada (que é anexado depois,
    // fora da query) — por isso a janela salva no banco precisa ter as
    // 20 cheias para excluir totalmente as antigas.
    const recentMessages = Array.from({ length: 20 }, (_, i) => ({
      id: `conv-recent-${i}`,
      lead_id: lead.id,
      unit_id: unit.id,
      channel: 'whatsapp',
      direction: i % 2 === 0 ? 'inbound' : 'outbound',
      content: `mensagem recente #${i}`,
      status: 'sent',
      sent_at: new Date(2026, 5, 1, 0, i).toISOString(),
      template_key: null,
    }))

    const { supabase } = createFakeSupabase({
      agent_configs: [config as unknown as Record<string, unknown>],
      conversations: [...oldMessages, ...recentMessages] as unknown as Record<string, unknown>[],
    })

    generateChatReplyMock.mockClear()

    const { processInboundMessage } = await import('@/lib/conversation-engine')
    await processInboundMessage({
      supabase,
      unit,
      lead,
      incomingText: 'pergunta atual do cliente',
    })

    expect(generateChatReplyMock).toHaveBeenCalledTimes(1)
    const { history } = generateChatReplyMock.mock.calls[0]![0]

    // Nenhuma mensagem antiga deve estar na janela enviada ao modelo.
    expect(history.some((m) => m.content.startsWith('mensagem antiga'))).toBe(false)

    // Todas as 20 recentes + a pergunta atual devem estar presentes.
    expect(history).toHaveLength(21)
    for (let i = 0; i < 20; i++) {
      expect(history.some((m) => m.content === `mensagem recente #${i}`)).toBe(true)
    }
    expect(history.at(-1)).toEqual({ role: 'user', content: 'pergunta atual do cliente' })

    // Ordem cronológica preservada dentro da janela (não invertida).
    const recentContents = history.slice(0, 20).map((m) => m.content)
    expect(recentContents).toEqual(recentMessages.map((m) => m.content))
  })
})
