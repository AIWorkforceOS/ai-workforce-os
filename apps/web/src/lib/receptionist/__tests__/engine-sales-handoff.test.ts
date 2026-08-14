import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'
import type { AgentConfig, Customer, Unit } from '@/lib/types'

// Item 3 do pedido de 2026-08-14, duas partes:
//
// 1. Quando a Recepcionista escala pra "sales", ela precisa acionar
//    handoffToSales com o HISTÓRICO REAL da conversa (não um lead novo sem
//    contexto) — ver generateHandoffMessage em lib/conversation-engine.ts e
//    o teste dedicado em lib/__tests__/handoff-message.test.ts. Aqui cobre
//    só a FIAÇÃO: handoffToSales é chamado com a história/motivo certos.
//
// 2. Continuidade: bug real confirmado em produção — depois de escalar pra
//    sales, se o cliente responde de novo no número da Recepcionista (natural,
//    é onde ele estava), ela ficava dizendo "vou verificar com o time" de
//    novo, porque nada avisava a fase de geração da resposta sobre o handoff
//    de um turno anterior. Cobre que, havendo um handoff sales recente pro
//    mesmo contato, o contexto passado ao modelo menciona o SDR que já
//    assumiu, em vez de reprometer verificação.

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

const notifyReceptionistHandoffMock = vi.fn(async (_supabase: unknown, _params: unknown) => undefined)
const handoffToSalesMock = vi.fn(async (_supabase: unknown, _params: unknown) => undefined)

vi.mock('@/lib/receptionist/handoff', () => ({
  notifyReceptionistHandoff: (supabase: unknown, params: unknown) => notifyReceptionistHandoffMock(supabase, params),
  handoffToSales: (supabase: unknown, params: unknown) => handoffToSalesMock(supabase, params),
}))

const REPLY_TEXT = 'Resposta final da recepcionista.'
const generateChatReplyMock = vi.fn(async (_params: { systemPrompt: string }) => REPLY_TEXT)

// Extração de intenção controlável por teste — 'sales' pra exercitar o
// acionamento, 'none' pra simular o turno seguinte (já escalado, extrator
// corretamente reconhece que não precisa escalar de novo).
let extractionHandoff: 'sales' | 'none' = 'sales'

vi.mock('@/lib/openai', () => ({
  getOpenAIApiKey: () => 'fake-key',
  generateChatReply: (params: { systemPrompt: string }) => generateChatReplyMock(params),
  generateStructuredReply: vi.fn(async () => ({
    handoff: extractionHandoff,
    handoff_reason: extractionHandoff === 'sales' ? 'cliente quer saber sobre parcelamento em 12x' : null,
    appointment_action: 'none',
    appointment_id: null,
    service_name: null,
    desired_date: null,
    desired_time: null,
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
    client_company: null,
    created_at: '',
    updated_at: '',
  }
}

function buildReceptionistConfig(unit: Unit): AgentConfig {
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

function buildSdrConfig(unit: Unit): AgentConfig {
  return {
    id: 'agent-config-sdr',
    unit_id: unit.id,
    agent_type: 'sdr',
    persona_name: 'Kai',
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

describe('processReceptionistInbound — handoff pra sales com contexto real', () => {
  beforeEach(() => {
    sendMessageMock.mockClear()
    notifyReceptionistHandoffMock.mockClear()
    handoffToSalesMock.mockClear()
    generateChatReplyMock.mockClear()
    extractionHandoff = 'sales'
  })

  it('aciona handoffToSales com o histórico real da conversa, o motivo e o nome da Recepcionista', async () => {
    const unit = buildUnit()
    const customer = buildCustomer(unit)
    const config = buildReceptionistConfig(unit)

    const { supabase } = createFakeSupabase({
      agent_configs: [config as unknown as Record<string, unknown>],
      customer_messages: [
        {
          id: 'msg-1',
          customer_id: customer.id,
          unit_id: unit.id,
          channel: 'whatsapp',
          direction: 'inbound',
          content: 'Vocês fazem parcelamento em 12x?',
          status: 'delivered',
          sent_at: new Date(Date.now() - 60_000).toISOString(),
        },
        {
          id: 'msg-2',
          customer_id: customer.id,
          unit_id: unit.id,
          channel: 'whatsapp',
          direction: 'outbound',
          content: 'Deixa eu verificar isso com o time.',
          status: 'sent',
          sent_at: new Date(Date.now() - 30_000).toISOString(),
        },
      ],
    })

    const { processReceptionistInbound } = await import('@/lib/receptionist/engine')

    const result = await processReceptionistInbound({
      supabase,
      unit,
      customer,
      incomingText: 'Vocês fazem parcelamento em 12x?',
      channel: 'whatsapp',
      recipient: customer.phone!,
    })

    expect(result.handled).toBe(true)
    expect(handoffToSalesMock).toHaveBeenCalledTimes(1)

    const call = handoffToSalesMock.mock.calls[0]![1] as {
      unit: Unit
      contact: { name: string }
      history: { role: string; content: string }[]
      reason: string
      fromPersonaName: string
    }
    expect(call.fromPersonaName).toBe('Ana')
    expect(call.reason).toBe('cliente quer saber sobre parcelamento em 12x')
    expect(call.history).toEqual([
      { role: 'user', content: 'Vocês fazem parcelamento em 12x?' },
      { role: 'assistant', content: 'Deixa eu verificar isso com o time.' },
    ])
  })
})

describe('processReceptionistInbound — continuidade pós-handoff pra sales', () => {
  beforeEach(() => {
    sendMessageMock.mockClear()
    notifyReceptionistHandoffMock.mockClear()
    handoffToSalesMock.mockClear()
    generateChatReplyMock.mockClear()
    extractionHandoff = 'none'
  })

  it('não reescala nem repromete "vou verificar" quando já existe handoff sales recente — menciona o SDR que assumiu', async () => {
    const unit = buildUnit()
    const customer = buildCustomer(unit)
    const config = buildReceptionistConfig(unit)
    const sdrConfig = buildSdrConfig(unit)

    const { supabase, db } = createFakeSupabase({
      agent_configs: [config, sdrConfig].map((c) => c as unknown as Record<string, unknown>),
      system_events: [
        {
          id: 'evt-sales-handoff',
          unit_id: unit.id,
          org_id: unit.org_id,
          event_type: 'receptionist_handoff_sales',
          level: 'info',
          source: 'receptionist',
          message: 'Escalação anterior pra sales.',
          metadata: { contact_id: customer.id, target: 'sales' },
          created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        },
      ],
    })

    const { processReceptionistInbound } = await import('@/lib/receptionist/engine')

    const result = await processReceptionistInbound({
      supabase,
      unit,
      customer,
      incomingText: 'oi, ainda estou esperando',
      channel: 'whatsapp',
      recipient: customer.phone!,
    })

    expect(result.handled).toBe(true)
    // Não reescala: nem um novo alerta, nem um novo acionamento do SDR.
    expect(notifyReceptionistHandoffMock).not.toHaveBeenCalled()
    expect(handoffToSalesMock).not.toHaveBeenCalled()

    const finalSystemPrompt = generateChatReplyMock.mock.calls[0]?.[0]?.systemPrompt as string
    expect(finalSystemPrompt).toContain('Kai')
    expect(finalSystemPrompt).toContain('já encaminhou')

    const handoffEvents = (db.system_events ?? []).filter((row) => row.event_type === 'receptionist_handoff_sales')
    expect(handoffEvents).toHaveLength(1)
  })
})
