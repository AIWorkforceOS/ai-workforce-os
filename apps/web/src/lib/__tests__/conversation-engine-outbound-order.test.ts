import { describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from './fake-supabase'
import type { AgentConfig, Lead, Unit } from '@/lib/types'

// Regressão (2026-08-01): o Sales Rep enviava a resposta pela Evolution API
// e só DEPOIS gravava a linha outbound em `conversations`. Isso abria uma
// janela de corrida em que o eco do próprio envio (Evolution/Baileys
// reentregando a mensagem como se fosse um inbound novo — ver
// isRecentOutboundEcho em inbound-router.ts) podia chegar ao webhook ANTES
// da linha outbound existir no banco. Sem a linha, o guard de eco não
// encontrava nada pra comparar, o eco virava uma "mensagem nova" e podia
// ser atribuído a outro lead pelo matching de telefone por sufixo — em
// produção isso apareceu como a resposta do Sales Rep para um lead sendo
// gravada como inbound de outro lead, quase no mesmo segundo (evidência
// direta no Supabase de produção, unit Matriz, teste de 2026-08-01).
//
// Este teste garante a invariante que fecha essa janela: a linha outbound
// já está persistida no banco no momento em que o envio real é disparado.

const { sendMessageMock } = vi.hoisted(() => ({
  sendMessageMock: vi.fn(async () => undefined),
}))

vi.mock('@/lib/channels/messaging-channel', () => ({
  getUnitChannelType: () => 'whatsapp' as const,
  channelLabel: () => 'WhatsApp',
  getMessagingChannel: () => ({ type: 'whatsapp' as const, sendMessage: sendMessageMock }),
  sendToLeadChannels: vi.fn(async () => []),
}))

const REPLY_TEXT = 'Parece que você precisa de ajuda com algo relacionado a finanças ou contratos. Pode me dizer qual é sua dúvida ou problema?'

vi.mock('@/lib/openai', () => ({
  getOpenAIApiKey: () => 'fake-key',
  generateChatReply: vi.fn(async () => REPLY_TEXT),
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
    id: 'lead-12ec325d',
    unit_id: unit.id,
    company_name: 'Lead de teste',
    contact_name: 'Cliente',
    phone: '5511988880001',
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

describe('processInboundMessage — ordem de gravação do outbound (regressão eco/corrida)', () => {
  it('grava a linha outbound em `conversations` ANTES de chamar sendMessage', async () => {
    const unit = buildUnit()
    const lead = buildLead(unit)
    const config = buildAgentConfig(unit)

    const { supabase, db } = createFakeSupabase({
      agent_configs: [config as unknown as Record<string, unknown>],
    })

    sendMessageMock.mockClear()
    sendMessageMock.mockImplementationOnce(async () => {
      // No instante em que o envio real dispara, a linha outbound já
      // precisa existir — é isso que faz isRecentOutboundEcho (ver
      // inbound-router.ts) enxergar o eco quando ele voltar pelo webhook.
      const outboundRows = (db.conversations ?? []).filter(
        (row) => row.direction === 'outbound' && row.lead_id === lead.id,
      )
      expect(outboundRows).toHaveLength(1)
      expect(outboundRows[0]?.content).toBe(REPLY_TEXT)
      expect(outboundRows[0]?.status).toBe('sent')
    })

    const { processInboundMessage } = await import('@/lib/conversation-engine')
    await processInboundMessage({
      supabase,
      unit,
      lead,
      incomingText: 'Vinicius, preciso de uma ajuda.',
    })

    expect(sendMessageMock).toHaveBeenCalledTimes(1)

    // Continua havendo só UMA linha outbound no final (nada duplicado).
    const finalOutboundRows = (db.conversations ?? []).filter(
      (row) => row.direction === 'outbound' && row.lead_id === lead.id,
    )
    expect(finalOutboundRows).toHaveLength(1)
    expect(finalOutboundRows[0]?.status).toBe('sent')
  })

  it('se o envio falhar, atualiza a linha já gravada para failed em vez de inserir uma segunda', async () => {
    const unit = buildUnit()
    const lead = buildLead(unit)
    const config = buildAgentConfig(unit)

    const { supabase, db } = createFakeSupabase({
      agent_configs: [config as unknown as Record<string, unknown>],
    })

    sendMessageMock.mockClear()
    sendMessageMock.mockImplementationOnce(async () => {
      throw new Error('Evolution API fora do ar')
    })

    const { processInboundMessage } = await import('@/lib/conversation-engine')
    await processInboundMessage({
      supabase,
      unit,
      lead,
      incomingText: 'Vinicius, preciso de uma ajuda.',
    })

    const outboundRows = (db.conversations ?? []).filter(
      (row) => row.direction === 'outbound' && row.lead_id === lead.id,
    )
    expect(outboundRows).toHaveLength(1)
    expect(outboundRows[0]?.status).toBe('failed')
  })
})
