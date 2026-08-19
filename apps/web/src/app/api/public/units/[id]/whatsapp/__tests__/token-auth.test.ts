import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'

// Achado P1.2 da auditoria de 18-19/08/2026: /api/public/units/[id]/whatsapp/
// {connect,status} usava createServiceClient() sem NENHUMA autenticação —
// quem soubesse (ou obtivesse de qualquer forma) o unit_id conseguia gerar
// um QR Code novo e re-parear o WhatsApp oficial de outra unidade,
// sequestrando o canal. Migration 068 adiciona units.whatsapp_connect_token
// e as rotas passam a exigir `?token=` batendo com a unidade certa.

const getEvolutionConfig = vi.fn(() => ({ instanceName: 'inst', apiUrl: 'https://evo.test', apiKey: 'key' }) as unknown)
const connectInstance = vi.fn(async () => ({ base64: 'qr-data', pairingCode: null }))
const ensureDedicatedWhatsappChannel = vi.fn(async () => null)
const getInstanceStatus = vi.fn(async () => 'connecting' as const)
const legacyWhatsappChannel = vi.fn((_supabase: unknown, unit: { evolution_instance_name?: string | null }) =>
  unit.evolution_instance_name ? { config: { instanceName: unit.evolution_instance_name } } : null,
)
const resolveWhatsappChannel = vi.fn(async () => null)
const syncWhatsappPhoneIfConnected = vi.fn(async () => undefined)
const ensureWebhookConfigured = vi.fn(async () => undefined)

function makeUnitRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'unit-1',
    org_id: 'org-1',
    name: 'Unidade Central',
    whatsapp_connect_token: 'correct-token',
    evolution_instance_name: 'inst',
    evolution_api_url: 'https://evo.test',
    evolution_api_key: 'key',
    ...overrides,
  }
}

beforeEach(() => {
  vi.resetModules()
  getEvolutionConfig.mockClear()
  connectInstance.mockClear()
  ensureDedicatedWhatsappChannel.mockClear()
  getInstanceStatus.mockClear()
  legacyWhatsappChannel.mockClear()
  resolveWhatsappChannel.mockClear()
  syncWhatsappPhoneIfConnected.mockClear()
  ensureWebhookConfigured.mockClear()
})

describe('POST /api/public/units/[id]/whatsapp/connect — exige token', () => {
  it('rejeita (401) quando não há token na URL, sem chamar a Evolution API', async () => {
    const { supabase } = createFakeSupabase({ units: [makeUnitRow()] })
    vi.doMock('@/lib/supabase/service', () => ({ createServiceClient: () => supabase }))
    vi.doMock('@/lib/evolution', () => ({ connectInstance, ensureDedicatedWhatsappChannel, getEvolutionConfig }))

    const { POST } = await import('../connect/route')
    const response = await POST(new Request('http://test/api/public/units/unit-1/whatsapp/connect', { method: 'POST' }), {
      params: Promise.resolve({ id: 'unit-1' }),
    })

    expect(response.status).toBe(401)
    expect(connectInstance).not.toHaveBeenCalled()
  })

  it('rejeita (401) quando o token não bate com o da unidade — sem vazar se a unidade existe', async () => {
    const { supabase } = createFakeSupabase({ units: [makeUnitRow()] })
    vi.doMock('@/lib/supabase/service', () => ({ createServiceClient: () => supabase }))
    vi.doMock('@/lib/evolution', () => ({ connectInstance, ensureDedicatedWhatsappChannel, getEvolutionConfig }))

    const { POST } = await import('../connect/route')
    const response = await POST(
      new Request('http://test/api/public/units/unit-1/whatsapp/connect?token=token-de-outra-unidade', { method: 'POST' }),
      { params: Promise.resolve({ id: 'unit-1' }) },
    )

    expect(response.status).toBe(401)
    expect(connectInstance).not.toHaveBeenCalled()
  })

  it('rejeita (401) o token correto de OUTRA unidade — token é escopado por unidade, não global', async () => {
    const { supabase } = createFakeSupabase({
      units: [makeUnitRow({ id: 'unit-1', whatsapp_connect_token: 'token-a' }), makeUnitRow({ id: 'unit-2', whatsapp_connect_token: 'token-b' })],
    })
    vi.doMock('@/lib/supabase/service', () => ({ createServiceClient: () => supabase }))
    vi.doMock('@/lib/evolution', () => ({ connectInstance, ensureDedicatedWhatsappChannel, getEvolutionConfig }))

    const { POST } = await import('../connect/route')
    // token-b é válido, mas pra unit-2 — tentando usar pra conectar unit-1
    const response = await POST(new Request('http://test/api/public/units/unit-1/whatsapp/connect?token=token-b', { method: 'POST' }), {
      params: Promise.resolve({ id: 'unit-1' }),
    })

    expect(response.status).toBe(401)
    expect(connectInstance).not.toHaveBeenCalled()
  })

  it('gera o QR Code com o token correto', async () => {
    const { supabase } = createFakeSupabase({ units: [makeUnitRow()] })
    vi.doMock('@/lib/supabase/service', () => ({ createServiceClient: () => supabase }))
    vi.doMock('@/lib/evolution', () => ({ connectInstance, ensureDedicatedWhatsappChannel, getEvolutionConfig }))

    const { POST } = await import('../connect/route')
    const response = await POST(
      new Request('http://test/api/public/units/unit-1/whatsapp/connect?token=correct-token', { method: 'POST' }),
      { params: Promise.resolve({ id: 'unit-1' }) },
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.qrCode).toBe('qr-data')
    expect(connectInstance).toHaveBeenCalledTimes(1)
  })
})

describe('GET /api/public/units/[id]/whatsapp/status — exige token', () => {
  it('rejeita (401) sem token, sem consultar a Evolution API', async () => {
    const { supabase } = createFakeSupabase({ units: [makeUnitRow()] })
    vi.doMock('@/lib/supabase/service', () => ({ createServiceClient: () => supabase }))
    vi.doMock('@/lib/evolution', () => ({
      ensureWebhookConfigured,
      getInstanceStatus,
      legacyWhatsappChannel,
      resolveWhatsappChannel,
      syncWhatsappPhoneIfConnected,
    }))

    const { GET } = await import('../status/route')
    const response = await GET(new Request('http://test/api/public/units/unit-1/whatsapp/status'), {
      params: Promise.resolve({ id: 'unit-1' }),
    })

    expect(response.status).toBe(401)
    expect(getInstanceStatus).not.toHaveBeenCalled()
  })

  it('consulta o status com o token correto', async () => {
    const { supabase } = createFakeSupabase({ units: [makeUnitRow()] })
    vi.doMock('@/lib/supabase/service', () => ({ createServiceClient: () => supabase }))
    vi.doMock('@/lib/evolution', () => ({
      ensureWebhookConfigured,
      getInstanceStatus,
      legacyWhatsappChannel,
      resolveWhatsappChannel,
      syncWhatsappPhoneIfConnected,
    }))

    const { GET } = await import('../status/route')
    const response = await GET(new Request('http://test/api/public/units/unit-1/whatsapp/status?token=correct-token'), {
      params: Promise.resolve({ id: 'unit-1' }),
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.status).toBe('connecting')
    expect(getInstanceStatus).toHaveBeenCalledTimes(1)
  })
})
