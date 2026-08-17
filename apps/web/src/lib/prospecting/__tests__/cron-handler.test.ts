import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'
import type { AgentConfig, Unit } from '@/lib/types'

// Handler HTTP compartilhado pelas 3 rotas de cron da prospecção
// (/api/cron/prospecting{,-midday,-afternoon}). Cobrimos a borda do
// handler: autenticação, degradação graciosa sem GOOGLE_MAPS_API_KEY, e a
// decisão de pular unidade fora do horário ativo sem derrubar o cron das
// demais — a lógica de captura/dedupe em si já é coberta em engine.test.ts.

const runProspectingForUnit = vi.fn(async (_params: { unit: Unit }) => ({ captured: 0, contacted: 0 }))
const isWithinActiveHours = vi.fn((_hours: { start: string }) => true)
const logSystemEvent = vi.fn(async () => {})

function makeUnit(overrides: Partial<Unit> = {}): Unit {
  return {
    id: 'unit-1', org_id: 'org-1', name: 'Unidade Teste', slug: 'unidade-teste',
    whatsapp_instance_id: null, whatsapp_phone: null, email_from: null, email_reply_to: null,
    logo_url: null, email_accent_color: null, email_footer_note: null, region_city: 'São Paulo', region_state: 'SP',
    evolution_api_url: null, evolution_api_key: null, evolution_instance_name: null,
    messaging_channel: null, twilio_account_sid: null, twilio_auth_token: null, twilio_phone_number: null,
    default_conversation_language: null, intake_token: null,
    crm_integration_mode: 'native', smarter_crm_partner_token: null,
    recruiting_integration_mode: 'native', smarter_recruiting_partner_token: null,
    smarter_recruiting_company_id: null, smarter_marketing_partner_token: null,
    public_lead_intake_token: null, timezone: 'America/Sao_Paulo', business_hours: {}, scheduling_settings: {},
    billing_company_name: null, billing_address: null, billing_email: null, billing_phone: null,
    billing_payment_instructions: null, is_active: true, created_at: '', updated_at: '',
    ...overrides,
  }
}

function makeConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: 'config-1', unit_id: 'unit-1', agent_type: 'sdr', persona_name: 'Bia', persona_tone: 'friendly',
    daily_limit: 50, active_hours: { start: '00:00', end: '23:59', days: [0, 1, 2, 3, 4, 5, 6] },
    escalation_rules: { after_messages: 5, keywords: [] }, sectors: [], is_active: true,
    created_at: '', updated_at: '',
    ...overrides,
  }
}

function makeRequest(secret: string | null): Request {
  const headers: Record<string, string> = {}
  if (secret !== null) headers.authorization = `Bearer ${secret}`
  return new Request('http://localhost/api/cron/prospecting', { headers })
}

/** Registra os mocks do handler (mesmo supabase fake por chamada) e importa o handler já com resetModules aplicado. */
async function loadHandler(supabase: ReturnType<typeof createFakeSupabase>['supabase']) {
  vi.doMock('@/lib/supabase/service', () => ({ createServiceClient: () => supabase }))
  vi.doMock('@/lib/prospecting/engine', () => ({ runProspectingForUnit }))
  vi.doMock('@/lib/conversation-engine', () => ({ isWithinActiveHours }))
  vi.doMock('@/lib/system-events', () => ({ logSystemEvent }))
  const { handleProspectingCron } = await import('../cron-handler')
  return handleProspectingCron
}

describe('handleProspectingCron', () => {
  const originalCronSecret = process.env.CRON_SECRET
  const originalMapsKey = process.env.GOOGLE_MAPS_API_KEY

  beforeEach(() => {
    vi.resetModules()
    runProspectingForUnit.mockReset().mockResolvedValue({ captured: 0, contacted: 0 })
    isWithinActiveHours.mockReset().mockReturnValue(true)
    logSystemEvent.mockReset().mockResolvedValue(undefined)
    process.env.CRON_SECRET = 'test-secret'
    process.env.GOOGLE_MAPS_API_KEY = 'maps-key'
  })

  afterEach(() => {
    process.env.CRON_SECRET = originalCronSecret
    process.env.GOOGLE_MAPS_API_KEY = originalMapsKey
  })

  it('sem CRON_SECRET configurado, o cron fica desabilitado (500) e não chama a prospecção', async () => {
    delete process.env.CRON_SECRET
    const { supabase } = createFakeSupabase()
    const handleProspectingCron = await loadHandler(supabase)

    const response = await handleProspectingCron(makeRequest('anything'))
    expect(response.status).toBe(500)
    expect(runProspectingForUnit).not.toHaveBeenCalled()
  })

  it('rejeita requisição sem o Bearer token correto (401)', async () => {
    const { supabase } = createFakeSupabase()
    const handleProspectingCron = await loadHandler(supabase)

    const response = await handleProspectingCron(makeRequest('wrong-secret'))
    expect(response.status).toBe(401)
    expect(runProspectingForUnit).not.toHaveBeenCalled()
  })

  it('sem GOOGLE_MAPS_API_KEY configurada, aborta com 500 e loga o evento — não quebra sem explicação', async () => {
    delete process.env.GOOGLE_MAPS_API_KEY
    const { supabase } = createFakeSupabase()
    const handleProspectingCron = await loadHandler(supabase)

    const response = await handleProspectingCron(makeRequest('test-secret'))
    expect(response.status).toBe(500)
    expect(logSystemEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: 'prospecting_missing_google_maps' }),
    )
    expect(runProspectingForUnit).not.toHaveBeenCalled()
  })

  it('pula unidade fora do horário ativo sem derrubar as demais, e soma os totais corretamente', async () => {
    const unitA = makeUnit({ id: 'unit-a', name: 'Unidade A' })
    const unitB = makeUnit({ id: 'unit-b', name: 'Unidade B' })
    const { supabase } = createFakeSupabase({
      units: [unitA, unitB],
      agent_configs: [
        makeConfig({ id: 'cfg-a', unit_id: 'unit-a', active_hours: { start: 'FORA', end: '23:59', days: [] } }),
        makeConfig({ id: 'cfg-b', unit_id: 'unit-b' }),
      ],
    })
    const handleProspectingCron = await loadHandler(supabase)

    // Unidade A tem o sentinela 'FORA' no active_hours — só ela é pulada.
    isWithinActiveHours.mockImplementation((hours: { start: string }) => hours.start !== 'FORA')
    runProspectingForUnit.mockResolvedValueOnce({ captured: 3, contacted: 1 })

    const response = await handleProspectingCron(makeRequest('test-secret'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(runProspectingForUnit).toHaveBeenCalledTimes(1)
    expect((runProspectingForUnit.mock.calls[0]![0] as { unit: Unit }).unit.id).toBe('unit-b')
    expect(body.captured).toBe(3)
    expect(body.contacted).toBe(1)
    expect(body.skippedUnits).toBe(1)
  })

  it('unidade cujo agent_config está inativa (is_active=false) nunca entra na rodada', async () => {
    const unit = makeUnit()
    const { supabase } = createFakeSupabase({
      units: [unit],
      agent_configs: [makeConfig({ is_active: false })],
    })
    const handleProspectingCron = await loadHandler(supabase)

    await handleProspectingCron(makeRequest('test-secret'))

    expect(runProspectingForUnit).not.toHaveBeenCalled()
  })
})
