import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'

// Achado P2.1 da auditoria de 18-19/08/2026 (item 13 do pedido): Tráfego,
// Conteúdo e SEO não têm o "Test Your AI Employee" baseado em chat — este
// endpoint cobre uma validação real, pré-ativação, específica de cada um.
// Nunca finge sucesso quando a validação de verdade não é possível (item
// 14: nunca mostrar como sucesso o que não foi validado).

const getOpenAIApiKey = vi.fn((): string | null => 'fake-key')
const generatePostContent = vi.fn(async () => ({ caption: 'Confira nosso serviço!', imagePrompt: 'a clean kitchen', reasoning: 'Post de teste.' }))
const runSeoAudit = vi.fn(async () => ({ score: 78, checks: [{ id: 'title' }, { id: 'https' }], errorMessage: null as string | null }))
const fetchOrganizationBusinessProfile = vi.fn(async () => ({ business_name: 'Padaria da Esquina' }))
const getMetaConfig = vi.fn((account: { access_token: string | null }) => (account.access_token ? { accessToken: account.access_token, adAccountId: 'act_1' } : null))
const getGoogleAdsConfig = vi.fn((_account: unknown) => null as { developerToken: string } | null)
const isDryRun = vi.fn(() => false)

function makeUnitRow(overrides: Record<string, unknown> = {}) {
  return { id: 'unit-1', org_id: 'org-1', name: 'Unidade Central', ...overrides }
}

function makeConfigRow(agentType: string, overrides: Record<string, unknown> = {}) {
  return { id: 'cfg-1', unit_id: 'unit-1', agent_type: agentType, persona_name: 'Assistente', business_profile: {}, ...overrides }
}

beforeEach(() => {
  vi.resetModules()
  getOpenAIApiKey.mockClear().mockReturnValue('fake-key')
  generatePostContent.mockClear()
  runSeoAudit.mockClear()
  fetchOrganizationBusinessProfile.mockClear()
  getMetaConfig.mockClear()
  getGoogleAdsConfig.mockClear().mockReturnValue(null)
  isDryRun.mockClear().mockReturnValue(false)
})

function mockDeps(supabase: unknown) {
  vi.doMock('@/lib/supabase/server', () => ({ createClient: async () => supabase }))
  vi.doMock('@/lib/openai', () => ({ getOpenAIApiKey }))
  vi.doMock('@/lib/content/generator', () => ({ generatePostContent }))
  vi.doMock('@/lib/seo/audit', () => ({ runSeoAudit }))
  vi.doMock('@/lib/organizations', () => ({ fetchOrganizationBusinessProfile }))
  vi.doMock('@/lib/traffic/meta-ads', () => ({ getMetaConfig }))
  vi.doMock('@/lib/traffic/google-ads', () => ({ getGoogleAdsConfig }))
  vi.doMock('@/lib/traffic/launcher', () => ({ isDryRun }))
}

function makeRequest(body: Record<string, unknown>) {
  return new Request('http://test/api/agent/pre-activation-test', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

describe('POST /api/agent/pre-activation-test', () => {
  it('400 quando agentType não é um dos 3 suportados', async () => {
    const { supabase } = createFakeSupabase({})
    mockDeps(supabase)
    const { POST } = await import('../route')
    const response = await POST(makeRequest({ unitId: 'unit-1', agentType: 'sdr' }))
    expect(response.status).toBe(400)
  })

  it('404 quando a unidade não é encontrada (ou RLS nega)', async () => {
    const { supabase } = createFakeSupabase({ units: [], agent_configs: [] })
    mockDeps(supabase)
    const { POST } = await import('../route')
    const response = await POST(makeRequest({ unitId: 'unit-1', agentType: 'seo_specialist' }))
    expect(response.status).toBe(404)
  })

  it('404 quando o funcionário ainda não foi treinado nesta unidade', async () => {
    const { supabase } = createFakeSupabase({ units: [makeUnitRow()], agent_configs: [] })
    mockDeps(supabase)
    const { POST } = await import('../route')
    const response = await POST(makeRequest({ unitId: 'unit-1', agentType: 'seo_specialist' }))
    expect(response.status).toBe(404)
  })

  describe('content_specialist', () => {
    it('gera a legenda de teste com sucesso', async () => {
      const { supabase } = createFakeSupabase({ units: [makeUnitRow()], agent_configs: [makeConfigRow('content_specialist')] })
      mockDeps(supabase)
      const { POST } = await import('../route')
      const response = await POST(makeRequest({ unitId: 'unit-1', agentType: 'content_specialist' }))
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.ok).toBe(true)
      expect(body.preview.caption).toBe('Confira nosso serviço!')
      expect(generatePostContent).toHaveBeenCalledWith(expect.objectContaining({ platform: 'instagram', pillar: null }))
    })

    it('422 sem OPENAI_API_KEY — nunca finge sucesso', async () => {
      getOpenAIApiKey.mockReturnValue(null)
      const { supabase } = createFakeSupabase({ units: [makeUnitRow()], agent_configs: [makeConfigRow('content_specialist')] })
      mockDeps(supabase)
      const { POST } = await import('../route')
      const response = await POST(makeRequest({ unitId: 'unit-1', agentType: 'content_specialist' }))
      const body = await response.json()

      expect(response.status).toBe(422)
      expect(body.ok).toBe(false)
      expect(generatePostContent).not.toHaveBeenCalled()
    })
  })

  describe('seo_specialist', () => {
    it('422 sem site_url configurado — nunca finge sucesso', async () => {
      const { supabase } = createFakeSupabase({ units: [makeUnitRow()], agent_configs: [makeConfigRow('seo_specialist', { business_profile: {} })] })
      mockDeps(supabase)
      const { POST } = await import('../route')
      const response = await POST(makeRequest({ unitId: 'unit-1', agentType: 'seo_specialist' }))
      const body = await response.json()

      expect(response.status).toBe(422)
      expect(body.ok).toBe(false)
      expect(runSeoAudit).not.toHaveBeenCalled()
    })

    it('roda a auditoria real e devolve o score quando o site está configurado', async () => {
      const { supabase } = createFakeSupabase({
        units: [makeUnitRow()],
        agent_configs: [makeConfigRow('seo_specialist', { business_profile: { site_url: 'https://padaria.com' } })],
      })
      mockDeps(supabase)
      const { POST } = await import('../route')
      const response = await POST(makeRequest({ unitId: 'unit-1', agentType: 'seo_specialist' }))
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.ok).toBe(true)
      expect(body.preview.score).toBe(78)
      expect(runSeoAudit).toHaveBeenCalledWith({ siteUrl: 'https://padaria.com' })
    })

    it('422 quando o site está fora do ar — repassa o erro real da auditoria', async () => {
      runSeoAudit.mockResolvedValue({ score: 0, checks: [], errorMessage: 'Não foi possível acessar https://padaria.com.' })
      const { supabase } = createFakeSupabase({
        units: [makeUnitRow()],
        agent_configs: [makeConfigRow('seo_specialist', { business_profile: { site_url: 'https://padaria.com' } })],
      })
      mockDeps(supabase)
      const { POST } = await import('../route')
      const response = await POST(makeRequest({ unitId: 'unit-1', agentType: 'seo_specialist' }))
      const body = await response.json()

      expect(response.status).toBe(422)
      expect(body.error).toContain('Não foi possível acessar')
    })
  })

  describe('traffic_specialist', () => {
    it('avisa que não há conta conectada quando nenhuma existe — não bloqueia a ativação', async () => {
      const { supabase } = createFakeSupabase({ units: [makeUnitRow()], agent_configs: [makeConfigRow('traffic_specialist')], ad_accounts: [] })
      mockDeps(supabase)
      const { POST } = await import('../route')
      const response = await POST(makeRequest({ unitId: 'unit-1', agentType: 'traffic_specialist' }))
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.ok).toBe(true)
      expect(body.preview.connected).toBe(false)
    })

    it('avisa quando existe conta mas sem credenciais válidas (fica SIMULADO)', async () => {
      const { supabase } = createFakeSupabase({
        units: [makeUnitRow()],
        agent_configs: [makeConfigRow('traffic_specialist')],
        ad_accounts: [{ id: 'acc-1', unit_id: 'unit-1', platform: 'meta', external_account_id: 'act_1', access_token: null, refresh_token: null }],
      })
      mockDeps(supabase)
      const { POST } = await import('../route')
      const response = await POST(makeRequest({ unitId: 'unit-1', agentType: 'traffic_specialist' }))
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.preview.connected).toBe(false)
    })

    it('confirma conexão real quando a conta tem credenciais válidas', async () => {
      const { supabase } = createFakeSupabase({
        units: [makeUnitRow()],
        agent_configs: [makeConfigRow('traffic_specialist')],
        ad_accounts: [{ id: 'acc-1', unit_id: 'unit-1', platform: 'meta', external_account_id: 'act_1', access_token: 'real-token', refresh_token: null }],
      })
      mockDeps(supabase)
      const { POST } = await import('../route')
      const response = await POST(makeRequest({ unitId: 'unit-1', agentType: 'traffic_specialist' }))
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.preview.connected).toBe(true)
    })

    it('TRAFFIC_DRY_RUN sempre reporta não-conectado, mesmo com credenciais válidas', async () => {
      isDryRun.mockReturnValue(true)
      const { supabase } = createFakeSupabase({
        units: [makeUnitRow()],
        agent_configs: [makeConfigRow('traffic_specialist')],
        ad_accounts: [{ id: 'acc-1', unit_id: 'unit-1', platform: 'meta', external_account_id: 'act_1', access_token: 'real-token', refresh_token: null }],
      })
      mockDeps(supabase)
      const { POST } = await import('../route')
      const response = await POST(makeRequest({ unitId: 'unit-1', agentType: 'traffic_specialist' }))
      const body = await response.json()

      expect(body.preview.connected).toBe(false)
      expect(body.preview.message).toContain('TRAFFIC_DRY_RUN')
    })
  })
})
