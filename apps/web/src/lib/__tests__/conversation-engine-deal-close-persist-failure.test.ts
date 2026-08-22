import { describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from './fake-supabase'
import type { AgentConfig, Lead, Unit } from '@/lib/types'

// Fase 7 (guarda contra invenção, docs/ux-audit-fase1-2026-08-19.md): o
// handoff Sales→Recrutador e o sync pro CRM da Smarter tratam
// dealHandoffReady=true como "negócio fechado de verdade" — não pode
// disparar isso se o UPDATE que marca leads.status='won' falhou. Antes
// desta correção, processInboundMessage não checava o erro do update e
// devolvia dealHandoffReady=true mesmo com a escrita falha (bug real,
// achado ao mapear os guardrails existentes antes de implementar a Fase 7).

const generateStructuredReplyMock = vi.fn(async () => ({ deal_confirmed: true, deal_profile_updates: {} }))
const generateChatReplyMock = vi.fn(async () => 'Combinado, vou seguir com isso por aqui!')
const sendMessageMock = vi.fn(async () => undefined)

vi.mock('@/lib/openai', () => ({
  getOpenAIApiKey: () => 'fake-key',
  generateChatReply: generateChatReplyMock,
  generateStructuredReply: generateStructuredReplyMock,
}))

vi.mock('@/lib/channels/messaging-channel', () => ({
  getUnitChannelType: () => 'whatsapp' as const,
  channelLabel: () => 'WhatsApp',
  getMessagingChannel: () => ({ type: 'whatsapp' as const, sendMessage: sendMessageMock }),
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

function buildUnit(): Unit {
  return {
    id: 'unit-1',
    org_id: 'org-1',
    name: 'Unidade Teste',
    slug: 'unidade-teste',
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
    id: 'lead-1',
    unit_id: unit.id,
    company_name: 'Empresa Teste',
    contact_name: 'Cliente',
    phone: '5511988887777',
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

function buildConfig(unit: Unit): AgentConfig {
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
    // fechamento_campos vazio: nada a perguntar, só precisa da confirmação
    // (mesmo caso "lista vazia" documentado em conversation-engine.ts).
    business_profile: { fechamento: 'fecha_sozinho', fechamento_campos: [] },
    interview_status: 'completed',
    interview_transcript: [],
    created_at: '',
    updated_at: '',
  }
}

describe('processInboundMessage — fechamento de negócio não persistido', () => {
  it('quando o UPDATE de leads.status=won falha, NÃO sinaliza dealHandoffReady nem mantém o lead como fechado', async () => {
    const unit = buildUnit()
    const lead = buildLead(unit)
    const config = buildConfig(unit)

    const { supabase, db } = createFakeSupabase(
      { agent_configs: [config as unknown as Record<string, unknown>], leads: [lead as unknown as Record<string, unknown>] },
      { leads: { update: 'connection reset' } },
    )

    const { processInboundMessage } = await import('@/lib/conversation-engine')
    const result = await processInboundMessage({ supabase, unit, lead, incomingText: 'Fechado, pode seguir!' })

    expect(result.dealHandoffReady).toBe(false)

    const storedLead = db.leads?.find((row) => row.id === lead.id) as unknown as Lead
    expect(storedLead.status).not.toBe('won')
    expect(storedLead.deal_closed_at).toBeNull()

    // A falha fica registrada — não desaparece silenciosamente.
    const failureEvent = db.system_events?.find((e) => e.event_type === 'deal_close_persist_failed')
    expect(failureEvent).toBeDefined()
  })

  it('controle: com o UPDATE funcionando normalmente, fecha e sinaliza o handoff', async () => {
    const unit = buildUnit()
    const lead = buildLead(unit)
    const config = buildConfig(unit)

    const { supabase, db } = createFakeSupabase({
      agent_configs: [config as unknown as Record<string, unknown>],
      leads: [lead as unknown as Record<string, unknown>],
    })

    const { processInboundMessage } = await import('@/lib/conversation-engine')
    const result = await processInboundMessage({ supabase, unit, lead, incomingText: 'Fechado, pode seguir!' })

    expect(result.dealHandoffReady).toBe(true)
    const storedLead = db.leads?.find((row) => row.id === lead.id) as unknown as Lead
    expect(storedLead.status).toBe('won')
  })
})
