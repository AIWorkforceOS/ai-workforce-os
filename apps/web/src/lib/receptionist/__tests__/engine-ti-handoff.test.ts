import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'
import type { AgentConfig, Customer, Lead, Unit } from '@/lib/types'

// Pedido do produto (2026-08-06): a Recepcionista precisa consultar o
// Funcionário TI DE VERDADE, durante a conversa, e devolver a resposta
// completa dele na mesma mensagem — nunca o handoff genérico "vou
// verificar com o time" para esse caso. Este arquivo cobre a integração
// entre processReceptionistInbound/processReceptionistProspectInbound e
// lib/ti/engine.ts.

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

const TI_ANSWER = 'Pra conectar o WhatsApp, vá em Unidades > Conectar WhatsApp e escaneie o QR code.'
const answerTechSupportQuestionMock = vi.fn(
  async (_supabase: unknown, _params: { unit: Unit; question: string }) => ({ answer: TI_ANSWER, filedIncident: false }),
)
vi.mock('@/lib/ti/engine', () => ({
  answerTechSupportQuestion: (supabase: unknown, params: { unit: Unit; question: string }) =>
    answerTechSupportQuestionMock(supabase, params),
}))

const generateChatReplyMock = vi.fn(async (_params: { systemPrompt: string }) => 'Resposta final da recepcionista, já incorporando o que o TI verificou.')

vi.mock('@/lib/openai', () => ({
  getOpenAIApiKey: () => 'fake-key',
  generateChatReply: (params: { systemPrompt: string }) => generateChatReplyMock(params),
  generateStructuredReply: vi.fn(async () => ({
    handoff: 'ti',
    handoff_reason: null,
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
    created_at: '',
    updated_at: '',
  }
}

function buildLead(unit: Unit): Lead {
  return {
    id: 'lead-1',
    unit_id: unit.id,
    company_name: 'Franqueado Teste',
    contact_name: 'Franqueado Teste',
    phone: '5511988880002',
    email: null,
    sector: null,
    city: null,
    state: null,
    source: 'whatsapp_inbound',
    status: 'new',
    google_place_id: null,
    external_lead_id: null,
    enrichment_data: null,
    enriched_at: null,
    notes: null,
    last_contacted_at: null,
    deal_profile: {},
    deal_closed_at: null,
    smarter_crm_lead_id: null,
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

describe('processReceptionistInbound — handoff "ti"', () => {
  beforeEach(() => {
    sendMessageMock.mockClear()
    answerTechSupportQuestionMock.mockClear()
    generateChatReplyMock.mockClear()
    answerTechSupportQuestionMock.mockImplementation(async () => ({ answer: TI_ANSWER, filedIncident: false }))
  })

  it('consulta o TI de verdade e incorpora a resposta dele na mesma mensagem, sem handoff genérico', async () => {
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
      incomingText: 'Como eu conecto o WhatsApp da minha unidade?',
      channel: 'whatsapp',
      recipient: customer.phone!,
    })

    expect(result.handled).toBe(true)
    expect(answerTechSupportQuestionMock).toHaveBeenCalledWith(supabase, {
      unit,
      question: 'Como eu conecto o WhatsApp da minha unidade?',
    })

    const finalSystemPrompt = generateChatReplyMock.mock.calls[0]?.[0]?.systemPrompt as string
    expect(finalSystemPrompt).toContain(TI_ANSWER)
    expect(finalSystemPrompt).not.toContain('vou verificar com o time')

    const handoffEvents = (db.system_events ?? []).filter((row) => String(row.event_type).startsWith('receptionist_handoff_'))
    expect(handoffEvents).toHaveLength(0)
    expect(sendMessageMock).toHaveBeenCalledTimes(1)
  })

  it('cai no handoff humano (com aviso genérico) se o TI interno falhar, sem deixar o cliente sem resposta', async () => {
    answerTechSupportQuestionMock.mockImplementation(async () => {
      throw new Error('OpenAI indisponível')
    })

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
      incomingText: 'Como eu conecto o WhatsApp da minha unidade?',
      channel: 'whatsapp',
      recipient: customer.phone!,
    })

    expect(result.handled).toBe(true)

    const finalSystemPrompt = generateChatReplyMock.mock.calls[0]?.[0]?.systemPrompt as string
    expect(finalSystemPrompt).not.toContain(TI_ANSWER)

    const handoffEvents = (db.system_events ?? []).filter((row) => row.event_type === 'receptionist_handoff_human')
    expect(handoffEvents).toHaveLength(1)
    expect(sendMessageMock).toHaveBeenCalledTimes(1)
  })
})

describe('processReceptionistProspectInbound — handoff "ti"', () => {
  beforeEach(() => {
    sendMessageMock.mockClear()
    answerTechSupportQuestionMock.mockClear()
    generateChatReplyMock.mockClear()
    answerTechSupportQuestionMock.mockImplementation(async () => ({ answer: TI_ANSWER, filedIncident: false }))
  })

  it('consulta o TI de verdade e incorpora a resposta dele na mesma mensagem, sem handoff genérico', async () => {
    const unit = buildUnit()
    const lead = buildLead(unit)
    const config = buildAgentConfig(unit)

    const { supabase, db } = createFakeSupabase({
      agent_configs: [config as unknown as Record<string, unknown>],
    })

    const { processReceptionistProspectInbound } = await import('@/lib/receptionist/engine')

    const result = await processReceptionistProspectInbound({
      supabase,
      unit,
      lead,
      incomingText: 'Como eu conecto o WhatsApp da minha unidade?',
      channel: 'whatsapp',
      recipient: lead.phone!,
    })

    expect(result.handled).toBe(true)
    expect(answerTechSupportQuestionMock).toHaveBeenCalledWith(supabase, {
      unit,
      question: 'Como eu conecto o WhatsApp da minha unidade?',
    })

    const finalSystemPrompt = generateChatReplyMock.mock.calls[0]?.[0]?.systemPrompt as string
    expect(finalSystemPrompt).toContain(TI_ANSWER)

    const handoffEvents = (db.system_events ?? []).filter((row) => String(row.event_type).startsWith('receptionist_handoff_'))
    expect(handoffEvents).toHaveLength(0)
    expect(sendMessageMock).toHaveBeenCalledTimes(1)
  })
})
