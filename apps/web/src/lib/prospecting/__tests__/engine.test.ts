import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'
import {
  DAILY_CAPTURE_LIMIT,
  resolveProspectingTarget,
  runProspectingForUnit,
} from '@/lib/prospecting/engine'
import type { AgentConfig, ProspectingProfile, Unit } from '@/lib/types'

// Motor da prospecção autônoma (migration 049): cobrimos o teto diário de
// captura (DAILY_CAPTURE_LIMIT), a deduplicação de empresa já capturada
// (google_place_id) e o comportamento quando o Google Places falha ou
// devolve vazio — o cron não pode quebrar por uma unidade com problema.

const { textSearch, placeDetails } = vi.hoisted(() => ({
  textSearch: vi.fn(),
  placeDetails: vi.fn(async () => ({})),
}))
const { triggerFirstContact } = vi.hoisted(() => ({
  triggerFirstContact: vi.fn(async () => true),
}))
const { logSystemEvent } = vi.hoisted(() => ({
  logSystemEvent: vi.fn(async () => {}),
}))

vi.mock('@/lib/google-places', () => ({ textSearch, placeDetails }))
vi.mock('@/lib/leads/lead-intake', () => ({ triggerFirstContact }))
vi.mock('@/lib/system-events', () => ({ logSystemEvent }))

function makeUnit(overrides: Partial<Unit> = {}): Unit {
  return {
    id: 'unit-1',
    org_id: 'org-1',
    name: 'Unidade Teste',
    slug: 'unidade-teste',
    whatsapp_instance_id: null,
    whatsapp_phone: null,
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
    ...overrides,
  }
}

function makeConfig(profile: ProspectingProfile, overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: 'config-1',
    unit_id: 'unit-1',
    agent_type: 'sdr',
    persona_name: 'Bia',
    persona_tone: 'friendly',
    daily_limit: 50,
    active_hours: { start: '00:00', end: '23:59', days: [0, 1, 2, 3, 4, 5, 6] },
    escalation_rules: { after_messages: 5, keywords: [] },
    sectors: [],
    is_active: true,
    prospecting_profile: profile,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

function placeResult(placeId: string, name: string) {
  return { place_id: placeId, name, formatted_address: 'Rua Teste, 1' }
}

describe('resolveProspectingTarget', () => {
  it('mode business_types sem nenhum tipo cadastrado: sem alvo (cron pula a unidade)', () => {
    const unit = makeUnit()
    const config = makeConfig({ mode: 'business_types', business_types: [], region: 'Centro' })
    expect(resolveProspectingTarget(config, unit)).toBeNull()
  })

  it('sem nenhuma referência de região (nem perfil, nem cadastro da unidade): sem alvo', () => {
    const unit = makeUnit({ region_city: null, region_state: null })
    const config = makeConfig({ mode: 'business_types', business_types: ['academias'], region: null })
    expect(resolveProspectingTarget(config, unit)).toBeNull()
  })

  it('mode business_types com tipos e região da unidade: monta o alvo corretamente', () => {
    const unit = makeUnit({ region_city: 'Campinas', region_state: 'SP' })
    const config = makeConfig({ mode: 'business_types', business_types: ['academias', 'estúdios de pilates'] })
    const target = resolveProspectingTarget(config, unit)
    expect(target).not.toBeNull()
    expect(target!.terms).toEqual(['academias', 'estúdios de pilates'])
    expect(target!.locationQuery).toBe('Campinas, SP')
    expect(target!.city).toBe('Campinas')
    expect(target!.state).toBe('SP')
  })

  it('mode general usa o setor livre como único termo de busca', () => {
    const unit = makeUnit({ region_city: 'Recife', region_state: 'PE' })
    const config = makeConfig({ mode: 'general', general_sector: 'serviços de beleza' })
    const target = resolveProspectingTarget(config, unit)
    expect(target?.terms).toEqual(['empresas de serviços de beleza'])
  })
})

describe('runProspectingForUnit', () => {
  beforeEach(() => {
    textSearch.mockReset()
    placeDetails.mockReset().mockResolvedValue({})
    triggerFirstContact.mockReset().mockResolvedValue(true)
    logSystemEvent.mockReset().mockResolvedValue(undefined)
  })

  it('sem perfil de segmentação configurado: pula a unidade sem chamar o Google Places', async () => {
    const unit = makeUnit()
    const config = makeConfig({ mode: 'business_types', business_types: [] })
    const { supabase } = createFakeSupabase()

    const result = await runProspectingForUnit({ supabase, unit, config, apiKey: 'key', deadline: Date.now() + 60_000 })

    expect(result.skipped).toBeTruthy()
    expect(textSearch).not.toHaveBeenCalled()
  })

  it('respeita o teto diário de captura: não busca além do que falta para bater DAILY_CAPTURE_LIMIT', async () => {
    const unit = makeUnit()
    const config = makeConfig({ mode: 'general', general_sector: 'pet shops' })
    const alreadyCaptured = DAILY_CAPTURE_LIMIT - 2 // só sobram 2 vagas hoje
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
    const { supabase, db } = createFakeSupabase({
      prospecting_daily_captures: [{ id: 'c1', unit_id: 'unit-1', capture_date: today, captured_count: alreadyCaptured }],
    })

    textSearch.mockResolvedValueOnce([
      placeResult('p1', 'Pet A'),
      placeResult('p2', 'Pet B'),
      placeResult('p3', 'Pet C'),
      placeResult('p4', 'Pet D'),
      placeResult('p5', 'Pet E'),
    ])

    const result = await runProspectingForUnit({ supabase, unit, config, apiKey: 'key', deadline: Date.now() + 60_000 })

    expect(result.captured).toBe(2)
    expect((db.leads ?? [])).toHaveLength(2)
    const captureRow = db.prospecting_daily_captures!.find((r) => r.unit_id === 'unit-1')!
    expect(captureRow.captured_count).toBe(DAILY_CAPTURE_LIMIT)
  })

  it('quando o teto diário já foi atingido, não chama o Google Places de jeito nenhum', async () => {
    const unit = makeUnit()
    const config = makeConfig({ mode: 'general', general_sector: 'pet shops' })
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
    const { supabase } = createFakeSupabase({
      prospecting_daily_captures: [{ id: 'c1', unit_id: 'unit-1', capture_date: today, captured_count: DAILY_CAPTURE_LIMIT }],
    })

    const result = await runProspectingForUnit({ supabase, unit, config, apiKey: 'key', deadline: Date.now() + 60_000 })

    expect(result.captured).toBe(0)
    expect(textSearch).not.toHaveBeenCalled()
  })

  it('deduplica empresas já capturadas antes (mesmo google_place_id não vira um novo lead)', async () => {
    const unit = makeUnit()
    const config = makeConfig({ mode: 'general', general_sector: 'pet shops' })
    const { supabase, db } = createFakeSupabase({
      leads: [{ id: 'lead-existing', unit_id: 'unit-1', google_place_id: 'p1', company_name: 'Pet A' }],
    })

    textSearch.mockResolvedValueOnce([placeResult('p1', 'Pet A'), placeResult('p2', 'Pet B')])

    const result = await runProspectingForUnit({ supabase, unit, config, apiKey: 'key', deadline: Date.now() + 60_000 })

    expect(result.captured).toBe(1) // só p2 é novo
    const newLeads = (db.leads ?? []).filter((l) => l.google_place_id === 'p2')
    expect(newLeads).toHaveLength(1)
    expect((db.leads ?? []).filter((l) => l.google_place_id === 'p1')).toHaveLength(1) // não duplicou
  })

  it('Google Places falhando não derruba o cron: marca o job como failed, loga o evento e devolve captured=0', async () => {
    const unit = makeUnit()
    const config = makeConfig({ mode: 'general', general_sector: 'pet shops' })
    const { supabase, db } = createFakeSupabase()

    textSearch.mockRejectedValueOnce(new Error('Google Places indisponível (simulado)'))

    const result = await runProspectingForUnit({ supabase, unit, config, apiKey: 'key', deadline: Date.now() + 60_000 })
    expect(result.captured).toBe(0)

    const job = db.prospecting_jobs!.find((r) => r.unit_id === 'unit-1')!
    expect(job.status).toBe('failed')
    expect(String(job.error_message)).toMatch(/indisponível/)
    expect(logSystemEvent).toHaveBeenCalledWith(
      supabase,
      expect.objectContaining({ eventType: 'prospecting_failed' }),
    )
  })

  it('Google Places devolvendo vazio não quebra: nenhum lead criado, job concluído normalmente', async () => {
    const unit = makeUnit()
    const config = makeConfig({ mode: 'general', general_sector: 'pet shops' })
    const { supabase, db } = createFakeSupabase()

    textSearch.mockResolvedValueOnce([])

    const result = await runProspectingForUnit({ supabase, unit, config, apiKey: 'key', deadline: Date.now() + 60_000 })

    expect(result.captured).toBe(0)
    expect(db.leads ?? []).toHaveLength(0)
    const job = db.prospecting_jobs!.find((r) => r.unit_id === 'unit-1')!
    expect(job.status).toBe('done')
    expect(job.total_new).toBe(0)
  })

  it('dispara o primeiro contato dos leads pendentes dentro do orçamento diário de mensagens', async () => {
    const unit = makeUnit()
    const config = makeConfig({ mode: 'general', general_sector: 'pet shops' }, { daily_limit: 5 })
    const { supabase } = createFakeSupabase({
      leads: [
        { id: 'lead-1', unit_id: 'unit-1', source: 'google_maps', status: 'new', phone: '5511999999999', email: null, created_at: '2026-01-01' },
        { id: 'lead-2', unit_id: 'unit-1', source: 'google_maps', status: 'new', phone: null, email: 'lead2@example.com', created_at: '2026-01-02' },
      ],
    })
    textSearch.mockResolvedValueOnce([])

    const result = await runProspectingForUnit({ supabase, unit, config, apiKey: 'key', deadline: Date.now() + 60_000 })

    expect(result.contacted).toBe(2)
    expect(triggerFirstContact).toHaveBeenCalledTimes(2)
  })

  it('sem orçamento de mensagens hoje (daily_limit já usado), não tenta contatar ninguém', async () => {
    const unit = makeUnit()
    const config = makeConfig({ mode: 'general', general_sector: 'pet shops' }, { daily_limit: 1 })
    const { supabase } = createFakeSupabase({
      conversations: [
        { id: 'c1', unit_id: 'unit-1', direction: 'outbound', template_key: 'x', sent_at: new Date().toISOString() },
      ],
      leads: [
        { id: 'lead-1', unit_id: 'unit-1', source: 'google_maps', status: 'new', phone: '5511999999999', email: null, created_at: '2026-01-01' },
      ],
    })
    textSearch.mockResolvedValueOnce([])

    const result = await runProspectingForUnit({ supabase, unit, config, apiKey: 'key', deadline: Date.now() + 60_000 })

    expect(result.contacted).toBe(0)
    expect(triggerFirstContact).not.toHaveBeenCalled()
  })
})
