import { beforeEach, describe, expect, it, vi } from 'vitest'
import { generateFirstContactMessage } from '@/lib/conversation-engine'
import type { AgentConfig, Lead, Unit } from '@/lib/types'

// Item 3 do pedido de não-bloqueio do WhatsApp: leads de tráfego pago
// (anúncio Meta/Google, intake com origem conhecida) precisam de uma
// primeira mensagem que reconheça o interesse já demonstrado pelo lead —
// nunca uma abordagem fria — para reduzir o risco de denúncia de spam no
// WhatsApp. Mocka só a OpenAI (generateChatReply) para inspecionar o
// systemPrompt gerado, sem depender de rede.

const { generateChatReply } = vi.hoisted(() => ({
  generateChatReply: vi.fn(async (_params: { systemPrompt: string }) => 'Olá! Tudo bem?'),
}))

vi.mock('@/lib/openai', () => ({
  getOpenAIApiKey: () => 'fake-key',
  generateChatReply,
}))

const unit: Unit = {
  id: 'unit-1',
  org_id: 'org-1',
  name: 'Unidade Teste',
  slug: 'unidade-teste',
  whatsapp_instance_id: null,
  whatsapp_phone: '5511999999999',
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

const config: AgentConfig = {
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
  business_profile: {},
  interview_status: 'completed',
  interview_transcript: [],
  created_at: '',
  updated_at: '',
}

function makeLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: 'lead-1',
    unit_id: unit.id,
    company_name: 'Padaria da Esquina',
    contact_name: 'Ana',
    phone: '5511988888888',
    email: null,
    sector: null,
    city: null,
    state: null,
    source: 'meta_lead_ad',
    status: 'new',
    google_place_id: null,
    enrichment_data: null,
    enriched_at: null,
    notes: null,
    last_contacted_at: null,
    deal_profile: {},
    deal_closed_at: null,
    smarter_crm_lead_id: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

describe('generateFirstContactMessage — contexto de origem do lead', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    generateChatReply.mockResolvedValue('Olá! Tudo bem?')
  })

  it('referencia o anúncio do Meta quando o lead veio de meta_lead_ad', async () => {
    await generateFirstContactMessage(config, unit, makeLead({ source: 'meta_lead_ad' }))

    const call = generateChatReply.mock.calls[0]![0] as { systemPrompt: string }
    expect(call.systemPrompt).toContain('Meta Ads')
    expect(call.systemPrompt).toContain('Nunca escreva como se fosse uma abordagem fria')
  })

  it('referencia o anúncio do Google quando o lead veio de google_lead_ad', async () => {
    await generateFirstContactMessage(config, unit, makeLead({ source: 'google_lead_ad' }))

    const call = generateChatReply.mock.calls[0]![0] as { systemPrompt: string }
    expect(call.systemPrompt).toContain('Google Ads')
  })

  it('inclui as notas do lead quando presentes (ex.: origem externa via intake público)', async () => {
    await generateFirstContactMessage(
      config,
      unit,
      makeLead({ source: 'smarter_landing_franquia', notes: 'Interessado em abrir uma franquia em Phoenix' }),
    )

    const call = generateChatReply.mock.calls[0]![0] as { systemPrompt: string }
    expect(call.systemPrompt).toContain('smarter_landing_franquia')
    expect(call.systemPrompt).toContain('Interessado em abrir uma franquia em Phoenix')
  })

  it('não adiciona contexto de origem para prospecção fria (google_maps)', async () => {
    await generateFirstContactMessage(config, unit, makeLead({ source: 'google_maps' }))

    const call = generateChatReply.mock.calls[0]![0] as { systemPrompt: string }
    expect(call.systemPrompt).not.toContain('abordagem fria/não solicitada')
  })

  it('não adiciona contexto de origem para lead cadastrado manualmente', async () => {
    await generateFirstContactMessage(config, unit, makeLead({ source: 'manual' }))

    const call = generateChatReply.mock.calls[0]![0] as { systemPrompt: string }
    expect(call.systemPrompt).not.toContain('abordagem fria/não solicitada')
  })
})
