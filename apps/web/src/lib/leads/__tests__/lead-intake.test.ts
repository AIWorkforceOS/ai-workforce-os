import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'
import { triggerFirstContact } from '@/lib/leads/lead-intake'
import type { AgentConfig, Lead, Unit } from '@/lib/types'

// Item 1 do pedido de não-bloqueio do WhatsApp: leads de prospecção fria
// (Google Maps) nunca podem receber o primeiro contato por WhatsApp/SMS,
// só por e-mail — e só quando a pesquisa automática (enrichment) achar um
// e-mail de contato. Qualquer outra origem de lead mantém o comportamento
// anterior (WhatsApp/SMS + e-mail em paralelo).

const {
  getMessagingChannel,
  getEmailChannel,
  getUnitChannelType,
  channelLabel,
  generateFirstContactMessage,
  isWithinActiveHours,
  countSentToday,
  sendAcrossChannels,
  ensureLeadEnrichment,
} = vi.hoisted(() => ({
  getMessagingChannel: vi.fn((_unit: Unit) => null as { type: string; sendMessage: () => void } | null),
  getEmailChannel: vi.fn((_unit: Unit) => null as { type: string; sendMessage: () => void } | null),
  getUnitChannelType: vi.fn((_unit: Unit) => 'whatsapp'),
  channelLabel: vi.fn((_type: string) => 'WhatsApp'),
  generateFirstContactMessage: vi.fn(async (_config: AgentConfig, _unit: Unit, _lead: Lead) => 'Olá! Tudo bem?'),
  isWithinActiveHours: vi.fn((_hours: unknown) => true),
  countSentToday: vi.fn(async (_supabase: unknown, _unitId: string) => 0),
  sendAcrossChannels: vi.fn(async (_params: unknown) => ({ anySent: true, attempts: [{ channel: 'email', ok: true }] })),
  ensureLeadEnrichment: vi.fn(async (_supabase: unknown, lead: Lead) => lead),
}))

vi.mock('@/lib/channels/messaging-channel', () => ({
  getMessagingChannel,
  getEmailChannel,
  getUnitChannelType,
  channelLabel,
}))

vi.mock('@/lib/conversation-engine', () => ({
  generateFirstContactMessage,
  isWithinActiveHours,
  countSentToday,
  sendAcrossChannels,
}))

vi.mock('@/lib/leads/enrichment', () => ({
  ensureLeadEnrichment,
}))

vi.mock('@/lib/sales/smarter-crm', () => ({
  syncLeadToSmarterCrm: vi.fn(async () => {}),
}))

function makeUnit(overrides: Partial<Unit> = {}): Unit {
  return {
    id: 'unit-1',
    org_id: 'org-1',
    name: 'Unidade Teste',
    slug: 'unidade-teste',
    whatsapp_instance_id: null,
    whatsapp_phone: '5511999999999',
    email_from: null,
    email_reply_to: null,
    logo_url: null,
    email_accent_color: null,
    email_footer_note: null,
    region_city: null,
    region_state: null,
    evolution_api_url: 'https://evo.test',
    evolution_api_key: 'key',
    evolution_instance_name: 'fake',
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
    ...overrides,
  }
}

function makeConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: 'cfg-sdr',
    unit_id: 'unit-1',
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
    ...overrides,
  }
}

function makeLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: 'lead-1',
    unit_id: 'unit-1',
    company_name: 'Padaria da Esquina',
    contact_name: null,
    phone: '5511988888888',
    email: null,
    sector: null,
    city: null,
    state: null,
    source: 'google_maps',
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

describe('triggerFirstContact — prospecção fria (Google Maps) é e-mail só', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    generateFirstContactMessage.mockResolvedValue('Olá! Tudo bem?')
    isWithinActiveHours.mockReturnValue(true)
    countSentToday.mockResolvedValue(0)
    sendAcrossChannels.mockResolvedValue({ anySent: true, attempts: [{ channel: 'email', ok: true }] })
    ensureLeadEnrichment.mockImplementation(async (_supabase: unknown, lead: Lead) => lead)
    getMessagingChannel.mockReturnValue({ type: 'whatsapp', sendMessage: vi.fn() })
    getEmailChannel.mockReturnValue({ type: 'email', sendMessage: vi.fn() })
  })

  function seedDb(unit: Unit, config: AgentConfig, lead?: Lead) {
    const { supabase, db } = createFakeSupabase({
      agent_configs: [config as unknown as Record<string, unknown>],
      leads: lead ? [lead as unknown as Record<string, unknown>] : [],
    })
    return { supabase, db }
  }

  it('não tenta contato quando a plataforma não tem e-mail configurado, mesmo com telefone', async () => {
    getEmailChannel.mockReturnValue(null)
    const unit = makeUnit()
    const lead = makeLead({ source: 'google_maps', phone: '5511988888888', email: null })
    const { supabase } = seedDb(unit, makeConfig(), lead)

    const result = await triggerFirstContact(supabase, unit, lead)

    expect(result).toBe(false)
    expect(sendAcrossChannels).not.toHaveBeenCalled()
  })

  it('não tenta contato quando a pesquisa automática não acha e-mail de contato', async () => {
    ensureLeadEnrichment.mockImplementation(async (_supabase: unknown, lead: Lead) => ({ ...lead, email: null }))
    const unit = makeUnit()
    const lead = makeLead({ source: 'google_maps', phone: '5511988888888', email: null })
    const { supabase } = seedDb(unit, makeConfig(), lead)

    const result = await triggerFirstContact(supabase, unit, lead)

    expect(result).toBe(false)
    expect(sendAcrossChannels).not.toHaveBeenCalled()
  })

  it('manda SOMENTE por e-mail quando a pesquisa acha um e-mail, mesmo o lead tendo telefone', async () => {
    ensureLeadEnrichment.mockImplementation(async (_supabase: unknown, lead: Lead) => ({
      ...lead,
      email: 'contato@padaria.com',
    }))
    const unit = makeUnit({ whatsapp_phone: '5511999999999' })
    const lead = makeLead({ source: 'google_maps', phone: '5511988888888', email: null })
    const { supabase } = seedDb(unit, makeConfig(), lead)

    const result = await triggerFirstContact(supabase, unit, lead)

    expect(result).toBe(true)
    expect(sendAcrossChannels).toHaveBeenCalledTimes(1)
    const call = sendAcrossChannels.mock.calls[0]![0] as { lead: { phone: string | null; email: string | null } }
    expect(call.lead.phone).toBeNull()
    expect(call.lead.email).toBe('contato@padaria.com')
  })

  it('inclui o botão de WhatsApp (wa.me da unidade) no e-mail da prospecção fria quando a unidade tem WhatsApp conectado', async () => {
    ensureLeadEnrichment.mockImplementation(async (_supabase: unknown, lead: Lead) => ({
      ...lead,
      email: 'contato@padaria.com',
    }))
    const unit = makeUnit({ whatsapp_phone: '5511999999999' })
    const lead = makeLead({ source: 'google_maps', phone: '5511988888888', email: null })
    const { supabase } = seedDb(unit, makeConfig(), lead)

    await triggerFirstContact(supabase, unit, lead)

    const call = sendAcrossChannels.mock.calls[0]![0] as { whatsappCta: { phone: string; text: string } | null }
    expect(call.whatsappCta?.phone).toBe('5511999999999')
    expect(call.whatsappCta?.text).toContain('Unidade Teste')
  })

  it('não inclui botão de WhatsApp quando a unidade nunca conectou o WhatsApp', async () => {
    ensureLeadEnrichment.mockImplementation(async (_supabase: unknown, lead: Lead) => ({
      ...lead,
      email: 'contato@padaria.com',
    }))
    const unit = makeUnit({ whatsapp_phone: null })
    const lead = makeLead({ source: 'google_maps', phone: '5511988888888', email: null })
    const { supabase } = seedDb(unit, makeConfig(), lead)

    await triggerFirstContact(supabase, unit, lead)

    const call = sendAcrossChannels.mock.calls[0]![0] as { whatsappCta: unknown }
    expect(call.whatsappCta).toBeNull()
  })

  it('leads de anúncio (não prospecção fria) continuam indo por WhatsApp direto, sem exigir e-mail', async () => {
    const unit = makeUnit()
    const lead = makeLead({ source: 'meta_lead_ad', phone: '5511988888888', email: null })
    const { supabase } = seedDb(unit, makeConfig(), lead)

    const result = await triggerFirstContact(supabase, unit, lead)

    expect(result).toBe(true)
    const call = sendAcrossChannels.mock.calls[0]![0] as {
      lead: { phone: string | null }
      whatsappCta: unknown
    }
    expect(call.lead.phone).toBe('5511988888888')
    expect(call.whatsappCta).toBeNull()
  })

  it('não tenta contato quando o lead de anúncio não tem telefone nem e-mail configurado na unidade', async () => {
    getEmailChannel.mockReturnValue(null)
    const unit = makeUnit()
    const lead = makeLead({ source: 'meta_lead_ad', phone: null, email: null })
    const { supabase } = seedDb(unit, makeConfig(), lead)

    const result = await triggerFirstContact(supabase, unit, lead)

    expect(result).toBe(false)
    expect(sendAcrossChannels).not.toHaveBeenCalled()
  })
})

// Regressão: prospecting/engine.ts relê leads 'new' de rodadas anteriores e
// chama triggerFirstContact de novo — se dois crons de prospecção
// sobrepuserem (ou um cron rodar junto de uma criação manual/webhook), as
// duas chamadas concorrentes passavam pelas mesmas checagens (config ativo,
// horário, limite diário) e podiam mandar a mesma mensagem duas vezes pro
// mesmo lead antes que a primeira terminasse de marcar status='contacted'.
// O claim atômico (status 'new' -> 'contacting' condicionado ao status
// ainda ser 'new') fecha essa janela.
describe('triggerFirstContact — claim atômico evita envio duplicado por concorrência', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    generateFirstContactMessage.mockResolvedValue('Olá! Tudo bem?')
    isWithinActiveHours.mockReturnValue(true)
    countSentToday.mockResolvedValue(0)
    sendAcrossChannels.mockResolvedValue({ anySent: true, attempts: [{ channel: 'whatsapp', ok: true }] })
    ensureLeadEnrichment.mockImplementation(async (_supabase: unknown, lead: Lead) => lead)
    getMessagingChannel.mockReturnValue({ type: 'whatsapp', sendMessage: vi.fn() })
    getEmailChannel.mockReturnValue({ type: 'email', sendMessage: vi.fn() })
  })

  it('duas execuções concorrentes sobre o mesmo lead só mandam a mensagem uma vez', async () => {
    const unit = makeUnit()
    const config = makeConfig()
    const lead = makeLead({ source: 'meta_lead_ad', phone: '5511988888888', email: null, status: 'new' })
    const { supabase, db } = createFakeSupabase({
      agent_configs: [config as unknown as Record<string, unknown>],
      leads: [lead as unknown as Record<string, unknown>],
    })

    const [first, second] = await Promise.all([
      triggerFirstContact(supabase, unit, lead),
      triggerFirstContact(supabase, unit, lead),
    ])

    // Exatamente uma das duas execuções concorrentes venceu o claim.
    expect([first, second].filter(Boolean)).toHaveLength(1)
    expect(sendAcrossChannels).toHaveBeenCalledTimes(1)

    const finalLead = db.leads![0] as unknown as Lead
    expect(finalLead.status).toBe('contacted')
  })

  it('quando o lead já foi reivindicado por outra execução (status != new), não envia nada', async () => {
    const unit = makeUnit()
    const config = makeConfig()
    const lead = makeLead({ source: 'meta_lead_ad', phone: '5511988888888', email: null, status: 'contacting' })
    const { supabase } = createFakeSupabase({
      agent_configs: [config as unknown as Record<string, unknown>],
      leads: [lead as unknown as Record<string, unknown>],
    })

    const result = await triggerFirstContact(supabase, unit, lead)

    expect(result).toBe(false)
    expect(sendAcrossChannels).not.toHaveBeenCalled()
  })

  it('libera o claim (volta status para new) quando o envio falha, para uma tentativa futura poder reprocessar', async () => {
    sendAcrossChannels.mockResolvedValue({ anySent: false, attempts: [{ channel: 'whatsapp', ok: false }] })
    const unit = makeUnit()
    const config = makeConfig()
    const lead = makeLead({ source: 'meta_lead_ad', phone: '5511988888888', email: null, status: 'new' })
    const { supabase, db } = createFakeSupabase({
      agent_configs: [config as unknown as Record<string, unknown>],
      leads: [lead as unknown as Record<string, unknown>],
    })

    const result = await triggerFirstContact(supabase, unit, lead)

    expect(result).toBe(false)
    const finalLead = db.leads![0] as unknown as Lead
    expect(finalLead.status).toBe('new')
  })
})
