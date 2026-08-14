import { beforeEach, describe, expect, it, vi } from 'vitest'
import { generateHandoffMessage } from '@/lib/conversation-engine'
import type { AgentConfig, Lead, Unit } from '@/lib/types'

// Item 3 do pedido de 2026-08-14: quando a Recepcionista escala pra venda,
// o SDR precisa assumir SABENDO da conversa que já rolou — não mandar a
// abertura fria genérica de generateFirstContactMessage (feita pra lead
// novo sem histórico). generateHandoffMessage usa o HISTÓRICO REAL como
// `history` do modelo (em vez do placeholder "Inicie a conversa com este
// lead") e instrui o modelo a se apresentar e responder de fato à dúvida.

const { generateChatReply } = vi.hoisted(() => ({
  generateChatReply: vi.fn(async (_params: { systemPrompt: string; history: unknown[] }) => 'Oi! Aqui é o Kai, do time comercial...'),
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
    company_name: 'Cliente Teste',
    contact_name: 'Ana Cliente',
    phone: '5511988888888',
    email: null,
    sector: null,
    city: null,
    state: null,
    source: 'receptionist_handoff',
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
    ...overrides,
  }
}

describe('generateHandoffMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    generateChatReply.mockResolvedValue('Oi! Aqui é o Kai, do time comercial...')
  })

  it('usa o histórico real da conversa (não o placeholder de cold-open)', async () => {
    const history = [
      { role: 'user' as const, content: 'Vocês fazem parcelamento em 12x?' },
      { role: 'assistant' as const, content: 'Deixa eu verificar isso com o time.' },
    ]

    await generateHandoffMessage(config, unit, makeLead(), {
      history,
      reason: 'cliente quer saber sobre parcelamento em 12x',
      fromPersonaName: 'Ana',
    })

    const call = generateChatReply.mock.calls[0]![0] as { systemPrompt: string; history: unknown[] }
    expect(call.history[0]).toEqual(history[0])
    expect(call.history[1]).toEqual(history[1])
    expect(call.history).not.toContainEqual({ role: 'user', content: 'Inicie a conversa com este lead.' })
  })

  it('instrui o modelo a se apresentar como o time comercial e citar o motivo do handoff', async () => {
    await generateHandoffMessage(config, unit, makeLead(), {
      history: [{ role: 'user', content: 'Quanto custa o plano premium?' }],
      reason: 'dúvida sobre preço do plano premium',
      fromPersonaName: 'Ana',
    })

    const call = generateChatReply.mock.calls[0]![0] as { systemPrompt: string }
    expect(call.systemPrompt).toContain('Ana')
    expect(call.systemPrompt).toContain('dúvida sobre preço do plano premium')
    expect(call.systemPrompt).toContain('nunca finja ser a mesma pessoa')
  })
})
