import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'
import type { AgentConfig, Customer, Unit } from '@/lib/types'

// Duas regressões confirmadas em produção (2026-08-06), unit Matriz, WhatsApp
// real: (1) reescalação de handoff repetida — 9 alertas em 22min pro mesmo
// contato, porque a única proteção era uma instrução de PROMPT pedindo pro
// modelo não reescalar, e isso não é confiável sob uso real; (2) respostas
// duplicadas — 2 mensagens do cliente chegando quase juntas disparavam 2
// pipelines completos em paralelo, e as 2 respostas saíam. Este arquivo cobre
// os dois guards determinísticos adicionados em engine.ts pra fechar as
// duas brechas (cooldown de handoff via system_events, staleness check via
// customer_messages).

const sendMessageMock = vi.fn(async () => undefined)

vi.mock('@/lib/channels/messaging-channel', () => ({
  getUnitChannelType: () => 'whatsapp' as const,
  channelLabel: () => 'WhatsApp',
  getMessagingChannel: () => ({ type: 'whatsapp' as const, sendMessage: sendMessageMock }),
  getEmailChannel: () => null,
  sendToLeadChannels: vi.fn(async () => []),
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

vi.mock('@/lib/email', () => ({
  sendEscalationEmail: vi.fn(async () => ({ ok: true })),
  sendTechnicalAlertEmail: vi.fn(async () => ({ ok: true })),
}))

const REPLY_TEXT = 'Deixa eu confirmar isso com o time e já volto com a resposta certa pra você.'

// Extração de intenção: por padrão devolve handoff "human" pra exercitar o
// cooldown; testes de staleness sobrescrevem pra "none" (não é o foco ali).
let extractionHandoff: 'human' | 'none' = 'human'

vi.mock('@/lib/openai', () => ({
  getOpenAIApiKey: () => 'fake-key',
  generateChatReply: vi.fn(async () => REPLY_TEXT),
  generateStructuredReply: vi.fn(async () => ({
    handoff: extractionHandoff,
    handoff_reason: 'cliente pediu cancelamento de contrato',
    appointment_action: 'none',
  })),
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

function buildCustomer(unit: Unit): Customer {
  return {
    id: 'customer-1',
    org_id: unit.org_id!,
    unit_id: unit.id,
    lead_id: null,
    name: 'Cliente Teste',
    phone: '5511988880001',
    email: null,
    address: null,
    city: null,
    status: 'active',
    tags: [],
    source: 'manual',
    notes: null,
    custom_fields: {},
    created_at: '',
    updated_at: '',
  }
}

function buildAgentConfig(unit: Unit): AgentConfig {
  return {
    id: 'agent-config-receptionist',
    unit_id: unit.id,
    agent_type: 'receptionist',
    persona_name: 'Ana',
    persona_tone: 'friendly',
    daily_limit: 50,
    active_hours: { start: '00:00', end: '23:59', days: [0, 1, 2, 3, 4, 5, 6] },
    escalation_rules: { after_messages: 999, keywords: [] },
    sectors: [],
    is_active: true,
    business_profile: {},
    interview_status: 'completed',
    interview_transcript: [],
    created_at: '',
    updated_at: '',
  }
}

describe('processReceptionistInbound — cooldown de reescalação de handoff', () => {
  beforeEach(() => {
    sendMessageMock.mockClear()
    extractionHandoff = 'human'
  })

  it('não dispara um novo alerta pro time quando já existe uma escalação recente pro mesmo contato', async () => {
    const unit = buildUnit()
    const customer = buildCustomer(unit)
    const config = buildAgentConfig(unit)

    const { supabase, db } = createFakeSupabase({
      agent_configs: [config as unknown as Record<string, unknown>],
      // Escalação já registrada há 10min pro MESMO contato — dentro da
      // janela de cooldown (120min).
      system_events: [
        {
          id: 'evt-prior',
          unit_id: unit.id,
          org_id: unit.org_id,
          event_type: 'receptionist_handoff_human',
          level: 'info',
          source: 'receptionist',
          message: 'Escalação anterior.',
          metadata: { contact_id: customer.id, target: 'human' },
          created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        },
      ],
    })

    const { processReceptionistInbound } = await import('@/lib/receptionist/engine')

    const result = await processReceptionistInbound({
      supabase,
      unit,
      customer,
      incomingText: 'ok, obrigado',
      channel: 'whatsapp',
      recipient: customer.phone!,
    })

    expect(result.handled).toBe(true)
    expect(sendMessageMock).toHaveBeenCalledTimes(1)

    // Nenhum NOVO evento de handoff foi gravado — só o que já existia antes.
    const handoffEvents = (db.system_events ?? []).filter(
      (row) => row.event_type === 'receptionist_handoff_human',
    )
    expect(handoffEvents).toHaveLength(1)
  })

  it('dispara o alerta normalmente quando não há escalação recente pro contato', async () => {
    const unit = buildUnit()
    const customer = buildCustomer(unit)
    const config = buildAgentConfig(unit)

    const { supabase, db } = createFakeSupabase({
      agent_configs: [config as unknown as Record<string, unknown>],
    })

    const { processReceptionistInbound } = await import('@/lib/receptionist/engine')

    const result = await processReceptionistInbound({
      supabase,
      unit,
      customer,
      incomingText: 'quero cancelar meu contrato',
      channel: 'whatsapp',
      recipient: customer.phone!,
    })

    expect(result.handled).toBe(true)

    const handoffEvents = (db.system_events ?? []).filter(
      (row) => row.event_type === 'receptionist_handoff_human',
    )
    expect(handoffEvents).toHaveLength(1)
    expect((handoffEvents[0]?.metadata as { contact_id?: string })?.contact_id).toBe(customer.id)
  })
})

describe('processReceptionistInbound — staleness check (debounce de resposta duplicada)', () => {
  beforeEach(() => {
    sendMessageMock.mockClear()
    extractionHandoff = 'none'
  })

  it('não gera nem envia resposta quando já existe uma mensagem inbound mais nova pro mesmo cliente', async () => {
    const unit = buildUnit()
    const customer = buildCustomer(unit)
    const config = buildAgentConfig(unit)

    const { supabase, db } = createFakeSupabase({
      agent_configs: [config as unknown as Record<string, unknown>],
      customer_messages: [
        {
          id: 'msg-being-processed',
          customer_id: customer.id,
          unit_id: unit.id,
          channel: 'whatsapp',
          direction: 'inbound',
          content: 'primeira mensagem',
          status: 'delivered',
          sent_at: new Date(Date.now() - 5000).toISOString(),
        },
        {
          id: 'msg-arrived-right-after',
          customer_id: customer.id,
          unit_id: unit.id,
          channel: 'whatsapp',
          direction: 'inbound',
          content: 'segunda mensagem, quase junto',
          status: 'delivered',
          sent_at: new Date().toISOString(),
        },
      ],
    })

    const { processReceptionistInbound } = await import('@/lib/receptionist/engine')

    const result = await processReceptionistInbound({
      supabase,
      unit,
      customer,
      incomingText: 'primeira mensagem',
      channel: 'whatsapp',
      recipient: customer.phone!,
      inboundMessageId: 'msg-being-processed',
    })

    expect(result.handled).toBe(false)
    expect(sendMessageMock).not.toHaveBeenCalled()

    const outboundRows = (db.customer_messages ?? []).filter((row) => row.direction === 'outbound')
    expect(outboundRows).toHaveLength(0)
  })

  it('gera e envia normalmente quando a mensagem sendo processada é a mais recente', async () => {
    const unit = buildUnit()
    const customer = buildCustomer(unit)
    const config = buildAgentConfig(unit)

    const { supabase } = createFakeSupabase({
      agent_configs: [config as unknown as Record<string, unknown>],
      customer_messages: [
        {
          id: 'msg-only-one',
          customer_id: customer.id,
          unit_id: unit.id,
          channel: 'whatsapp',
          direction: 'inbound',
          content: 'única mensagem',
          status: 'delivered',
          sent_at: new Date().toISOString(),
        },
      ],
    })

    const { processReceptionistInbound } = await import('@/lib/receptionist/engine')

    const result = await processReceptionistInbound({
      supabase,
      unit,
      customer,
      incomingText: 'única mensagem',
      channel: 'whatsapp',
      recipient: customer.phone!,
      inboundMessageId: 'msg-only-one',
    })

    expect(result.handled).toBe(true)
    expect(sendMessageMock).toHaveBeenCalledTimes(1)
  })

  it('sem inboundMessageId (chamador antigo), não aplica o staleness check', async () => {
    const unit = buildUnit()
    const customer = buildCustomer(unit)
    const config = buildAgentConfig(unit)

    const { supabase } = createFakeSupabase({
      agent_configs: [config as unknown as Record<string, unknown>],
      customer_messages: [
        {
          id: 'msg-newer',
          customer_id: customer.id,
          unit_id: unit.id,
          channel: 'whatsapp',
          direction: 'inbound',
          content: 'mensagem mais nova, mas sem id repassado pra comparar',
          status: 'delivered',
          sent_at: new Date().toISOString(),
        },
      ],
    })

    const { processReceptionistInbound } = await import('@/lib/receptionist/engine')

    const result = await processReceptionistInbound({
      supabase,
      unit,
      customer,
      incomingText: 'mensagem',
      channel: 'whatsapp',
      recipient: customer.phone!,
    })

    expect(result.handled).toBe(true)
    expect(sendMessageMock).toHaveBeenCalledTimes(1)
  })
})
