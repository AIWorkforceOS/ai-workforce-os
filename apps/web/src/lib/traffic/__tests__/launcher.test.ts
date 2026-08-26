// Orquestração de criação de campanha (launcher.ts): fallback mock sem
// credenciais, e ordem de dependência entre chamadas quando há
// credenciais reais configuradas (payload/sequência, não comportamento
// real da API — isso só um teste com conta de verdade confirma).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { launchCampaign } from '../launcher'
import type { AdAccount, NewCampaignSpec } from '../types'

// Garante que os testes "sem credenciais" caiam no fallback mock mesmo que
// o ambiente local/CI tenha essas envs setadas para outro fim — contas com
// credenciais próprias (nos testes abaixo) sempre têm precedência sobre a env.
beforeEach(() => {
  vi.stubEnv('META_SYSTEM_USER_TOKEN', '')
  vi.stubEnv('GOOGLE_ADS_DEVELOPER_TOKEN', '')
  vi.stubEnv('GOOGLE_ADS_CLIENT_ID', '')
  vi.stubEnv('GOOGLE_ADS_CLIENT_SECRET', '')
  vi.stubEnv('GOOGLE_ADS_REFRESH_TOKEN', '')
  vi.stubEnv('TRAFFIC_DRY_RUN', '')
})

function baseAccount(overrides: Partial<AdAccount>): AdAccount {
  return {
    id: 'account_1',
    org_id: 'org_1',
    unit_id: 'unit_1',
    platform: 'meta',
    external_account_id: '999',
    name: 'Conta Teste',
    currency: 'BRL',
    timezone: 'America/Sao_Paulo',
    access_token: null,
    refresh_token: null,
    google_developer_token: null,
    google_client_id: null,
    google_client_secret: null,
    connection_status: 'connected',
    connection_error: null,
    optimization_mode: 'suggestion',
    strategy: {},
    last_synced_at: null,
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

const baseSpec: NewCampaignSpec = {
  name: 'Campanha Nova',
  objective: 'OUTCOME_TRAFFIC',
  dailyBudgetCents: 10000,
  targeting: { countries: ['BR'] },
  creative: { headline: 'Título do anúncio', body: 'Corpo do anúncio com a promessa principal.', linkUrl: 'https://example.com' },
}

type FakeCall = { table: string; op: 'upsert' | 'insert'; payload: unknown }

function makeFakeSupabase() {
  const calls: FakeCall[] = []
  const raw = {
    from(table: string) {
      return {
        upsert(rows: Record<string, unknown>[]) {
          calls.push({ table, op: 'upsert', payload: rows })
          return {
            select: async () => ({
              data: rows.map((row, i) => ({ id: `db_${i}`, entity_level: row.entity_level, external_id: row.external_id })),
              error: null,
            }),
          }
        },
        insert(row: Record<string, unknown>) {
          calls.push({ table, op: 'insert', payload: row })
          return Promise.resolve({ data: null, error: null })
        },
      }
    },
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- lightweight fake, shape intentionally narrower than SupabaseClient
  const client = raw as any
  return { client, calls }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('launchCampaign — fallback mock sem credenciais', () => {
  it('conta Meta sem access_token: nunca chama fetch, resultado mock com 3 entidades persistidas', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { client, calls } = makeFakeSupabase()

    const outcome = await launchCampaign(client, {
      account: baseAccount({ platform: 'meta', access_token: null }),
      spec: baseSpec,
      executedBy: 'human_approved:test@example.com',
    })

    expect(outcome.result).toBe('mock')
    expect(outcome.campaignExternalId).toMatch(/^mock_campaign_/)
    expect(fetchMock).not.toHaveBeenCalled()

    const upsertCall = calls.find((c) => c.table === 'ad_entities' && c.op === 'upsert')
    expect(upsertCall).toBeTruthy()
    const rows = upsertCall!.payload as Record<string, unknown>[]
    expect(rows.map((r) => r.entity_level)).toEqual(['campaign', 'ad_set', 'ad'])
    expect(rows.every((r) => r.is_managed === true)).toBe(true)
    expect(rows.every((r) => r.is_simulated === true)).toBe(true)

    const logCall = calls.find((c) => c.table === 'ad_actions_log' && c.op === 'insert')
    expect(logCall).toBeTruthy()
    const log = logCall!.payload as Record<string, unknown>
    expect(log.action_type).toBe('launch_campaign')
    expect(log.result).toBe('mock')
    expect(log.executed_by).toBe('human_approved:test@example.com')
  })

  it('conta Google sem refresh_token: fallback mock com 4 steps (budget→campaign→ad_set→ad)', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { client } = makeFakeSupabase()

    const outcome = await launchCampaign(client, {
      account: baseAccount({ platform: 'google', refresh_token: null }),
      spec: { ...baseSpec, objective: 'SEARCH' },
      executedBy: 'agent_autonomous',
    })

    expect(outcome.result).toBe('mock')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(outcome.steps.map((s) => s.step)).toEqual(['budget', 'campaign', 'ad_set', 'ad'])
  })
})

describe('launchCampaign — Meta com credenciais reais (fetch mockado)', () => {
  it('sem metaPageId: campanha e conjunto são criados, mas o anúncio não (partial)', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/campaigns')) return { ok: true, json: async () => ({ id: 'camp_1' }) }
      if (url.includes('/adsets')) return { ok: true, json: async () => ({ id: 'adset_1' }) }
      throw new Error(`chamada inesperada: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const { client, calls } = makeFakeSupabase()

    const outcome = await launchCampaign(client, {
      account: baseAccount({ platform: 'meta', access_token: 'token123' }),
      spec: baseSpec, // sem metaPageId
      executedBy: 'human_approved:test@example.com',
    })

    expect(outcome.result).toBe('partial')
    expect(outcome.campaignExternalId).toBe('camp_1')
    expect(outcome.adSetExternalId).toBe('adset_1')
    expect(outcome.adExternalId).toBeNull()
    expect(outcome.error).toMatch(/Página do Facebook/)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    const upsertCall = calls.find((c) => c.table === 'ad_entities' && c.op === 'upsert')
    const rows = upsertCall!.payload as Record<string, unknown>[]
    expect(rows.map((r) => r.entity_level)).toEqual(['campaign', 'ad_set'])
    expect(rows.every((r) => r.is_simulated === false)).toBe(true)
  })

  it('com metaPageId: cria os 4 recursos em sequência (campaign → ad_set → creative → ad)', async () => {
    const calledUrls: string[] = []
    const fetchMock = vi.fn(async (url: string) => {
      calledUrls.push(url)
      if (url.includes('/campaigns')) return { ok: true, json: async () => ({ id: 'camp_1' }) }
      if (url.includes('/adsets')) return { ok: true, json: async () => ({ id: 'adset_1' }) }
      if (url.includes('/adcreatives')) return { ok: true, json: async () => ({ id: 'creative_1' }) }
      if (url.includes('/ads')) return { ok: true, json: async () => ({ id: 'ad_1' }) }
      throw new Error(`chamada inesperada: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const { client } = makeFakeSupabase()

    const outcome = await launchCampaign(client, {
      account: baseAccount({ platform: 'meta', access_token: 'token123' }),
      spec: { ...baseSpec, metaPageId: 'page_1' },
      executedBy: 'human_approved:test@example.com',
    })

    expect(outcome.result).toBe('success')
    expect(outcome.campaignExternalId).toBe('camp_1')
    expect(outcome.adSetExternalId).toBe('adset_1')
    expect(outcome.adExternalId).toBe('ad_1')
    expect(calledUrls[0]).toContain('/campaigns')
    expect(calledUrls[1]).toContain('/adsets')
    expect(calledUrls[2]).toContain('/adcreatives')
    expect(calledUrls[3]).toContain('/ads')
  })

  it('regressão (2026-08-27): OUTCOME_LEADS com metaPageId cria formulário nativo e aponta o ad set/criativo pra ele', async () => {
    const calledUrls: string[] = []
    const fetchMock = vi.fn(async (url: string, init?: { body?: URLSearchParams }) => {
      calledUrls.push(url)
      if (url.includes('/leadgen_forms')) return { ok: true, json: async () => ({ id: 'form_1' }) }
      if (url.includes('/campaigns')) return { ok: true, json: async () => ({ id: 'camp_1' }) }
      if (url.includes('/adsets')) {
        expect(JSON.parse((init?.body as URLSearchParams).get('promoted_object')!)).toEqual({ page_id: 'page_1' })
        expect((init?.body as URLSearchParams).get('optimization_goal')).toBe('LEAD_GENERATION')
        expect((init?.body as URLSearchParams).get('destination_type')).toBe('ON_AD')
        return { ok: true, json: async () => ({ id: 'adset_1' }) }
      }
      if (url.includes('/adcreatives')) {
        const spec = JSON.parse((init?.body as URLSearchParams).get('object_story_spec')!)
        expect(spec.link_data.call_to_action).toEqual({ type: 'SIGN_UP', value: { lead_gen_form_id: 'form_1' } })
        return { ok: true, json: async () => ({ id: 'creative_1' }) }
      }
      if (url.includes('/ads')) return { ok: true, json: async () => ({ id: 'ad_1' }) }
      throw new Error(`chamada inesperada: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const { client } = makeFakeSupabase()

    const outcome = await launchCampaign(client, {
      account: baseAccount({ platform: 'meta', access_token: 'token123' }),
      spec: { ...baseSpec, objective: 'OUTCOME_LEADS', metaPageId: 'page_1' },
      executedBy: 'human_approved:test@example.com',
    })

    expect(outcome.result).toBe('success')
    expect(outcome.steps.find((s) => s.step === 'lead_form')?.externalId).toBe('form_1')
    expect(calledUrls[1]).toContain('/leadgen_forms')
  })

  it('regressão (2026-08-27): formulário nativo falha (ex.: permissão pendente) — cai de volta pro fluxo com link, campanha continua com sucesso', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/leadgen_forms')) return { ok: false, json: async () => ({ error: { message: 'leads_retrieval permission missing' } }) }
      if (url.includes('/campaigns')) return { ok: true, json: async () => ({ id: 'camp_1' }) }
      if (url.includes('/adsets')) return { ok: true, json: async () => ({ id: 'adset_1' }) }
      if (url.includes('/adcreatives')) return { ok: true, json: async () => ({ id: 'creative_1' }) }
      if (url.includes('/ads')) return { ok: true, json: async () => ({ id: 'ad_1' }) }
      throw new Error(`chamada inesperada: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const { client } = makeFakeSupabase()

    const outcome = await launchCampaign(client, {
      account: baseAccount({ platform: 'meta', access_token: 'token123' }),
      spec: { ...baseSpec, objective: 'OUTCOME_LEADS', metaPageId: 'page_1' },
      executedBy: 'human_approved:test@example.com',
    })

    expect(outcome.result).toBe('success')
    expect(outcome.adExternalId).toBe('ad_1')
    const leadFormStep = outcome.steps.find((s) => s.step === 'lead_form')
    expect(leadFormStep?.externalId).toBeNull()
    expect(leadFormStep?.error).toMatch(/leads_retrieval permission missing/)
  })

  it('repassa creative.imageUrl para o adcreative (picture no link_data)', async () => {
    let creativeBody: URLSearchParams | null = null
    const fetchMock = vi.fn(async (url: string, init?: { body?: URLSearchParams }) => {
      if (url.includes('/adcreatives')) creativeBody = init?.body as URLSearchParams
      if (url.includes('/campaigns')) return { ok: true, json: async () => ({ id: 'camp_1' }) }
      if (url.includes('/adsets')) return { ok: true, json: async () => ({ id: 'adset_1' }) }
      if (url.includes('/adcreatives')) return { ok: true, json: async () => ({ id: 'creative_1' }) }
      if (url.includes('/ads')) return { ok: true, json: async () => ({ id: 'ad_1' }) }
      throw new Error(`chamada inesperada: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const { client } = makeFakeSupabase()

    await launchCampaign(client, {
      account: baseAccount({ platform: 'meta', access_token: 'token123' }),
      spec: {
        ...baseSpec,
        metaPageId: 'page_1',
        creative: { ...baseSpec.creative, imageUrl: 'https://storage.example.com/unit-1/traffic/img.png' },
      },
      executedBy: 'human_approved:test@example.com',
    })

    const objectStorySpec = JSON.parse(creativeBody!.get('object_story_spec')!)
    expect(objectStorySpec.link_data.picture).toBe('https://storage.example.com/unit-1/traffic/img.png')
  })
})

describe('launchCampaign — Google com credenciais reais (fetch mockado)', () => {
  function stubGoogleOAuthAndMutations(handlers: Record<string, unknown>) {
    const calledUrls: string[] = []
    const fetchMock = vi.fn(async (url: string) => {
      calledUrls.push(url)
      if (url.includes('oauth2/v3/token')) return { ok: true, json: async () => ({ access_token: 'gtoken' }) }
      for (const [marker, body] of Object.entries(handlers)) {
        if (url.includes(marker)) return { ok: true, json: async () => body }
      }
      throw new Error(`chamada inesperada: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    return { fetchMock, calledUrls }
  }

  it('respeita a ordem budget → campaign → ad_group → ad para objective=SEARCH', async () => {
    const { calledUrls } = stubGoogleOAuthAndMutations({
      'campaignBudgets:mutate': { results: [{ resourceName: 'customers/1/campaignBudgets/1' }] },
      'campaigns:mutate': { results: [{ resourceName: 'customers/1/campaigns/2' }] },
      'adGroups:mutate': { results: [{ resourceName: 'customers/1/adGroups/3' }] },
      'adGroupAds:mutate': { results: [{ resourceName: 'customers/1/adGroupAds/4' }] },
    })
    const { client } = makeFakeSupabase()

    const outcome = await launchCampaign(client, {
      account: baseAccount({
        platform: 'google',
        refresh_token: 'rt',
        google_developer_token: 'dt',
        google_client_id: 'ci',
        google_client_secret: 'cs',
        external_account_id: '1',
      }),
      spec: { ...baseSpec, objective: 'SEARCH' },
      executedBy: 'human_approved:test@example.com',
    })

    expect(outcome.result).toBe('success')
    expect(outcome.campaignExternalId).toBe('2')
    expect(outcome.adSetExternalId).toBe('3')
    expect(outcome.adExternalId).toBe('4')

    const mutationUrls = calledUrls.filter((u) => !u.includes('oauth2'))
    expect(mutationUrls[0]).toContain('campaignBudgets:mutate')
    expect(mutationUrls[1]).toContain('campaigns:mutate')
    expect(mutationUrls[2]).toContain('adGroups:mutate')
    expect(mutationUrls[3]).toContain('adGroupAds:mutate')
  })

  it('objective=DISPLAY: cria budget+campaign mas para antes do ad group (partial, documenta a limitação)', async () => {
    const { calledUrls } = stubGoogleOAuthAndMutations({
      'campaignBudgets:mutate': { results: [{ resourceName: 'customers/1/campaignBudgets/1' }] },
      'campaigns:mutate': { results: [{ resourceName: 'customers/1/campaigns/2' }] },
    })
    const { client } = makeFakeSupabase()

    const outcome = await launchCampaign(client, {
      account: baseAccount({
        platform: 'google',
        refresh_token: 'rt',
        google_developer_token: 'dt',
        google_client_id: 'ci',
        google_client_secret: 'cs',
        external_account_id: '1',
      }),
      spec: { ...baseSpec, objective: 'DISPLAY' },
      executedBy: 'human_approved:test@example.com',
    })

    expect(outcome.result).toBe('partial')
    expect(outcome.campaignExternalId).toBe('2')
    expect(outcome.adSetExternalId).toBeNull()
    expect(outcome.error).toMatch(/asset groups/)
    expect(calledUrls.some((u) => u.includes('adGroups:mutate'))).toBe(false)
  })

  it('objective=DISPLAY com imageUrl aprovada: mensagem documenta que a imagem não é anexada automaticamente', async () => {
    stubGoogleOAuthAndMutations({
      'campaignBudgets:mutate': { results: [{ resourceName: 'customers/1/campaignBudgets/1' }] },
      'campaigns:mutate': { results: [{ resourceName: 'customers/1/campaigns/2' }] },
    })
    const { client } = makeFakeSupabase()

    const outcome = await launchCampaign(client, {
      account: baseAccount({
        platform: 'google',
        refresh_token: 'rt',
        google_developer_token: 'dt',
        google_client_id: 'ci',
        google_client_secret: 'cs',
        external_account_id: '1',
      }),
      spec: {
        ...baseSpec,
        objective: 'DISPLAY',
        creative: { ...baseSpec.creative, imageUrl: 'https://storage.example.com/unit-1/traffic/img.png' },
      },
      executedBy: 'human_approved:test@example.com',
    })

    expect(outcome.result).toBe('partial')
    expect(outcome.error).toContain('https://storage.example.com/unit-1/traffic/img.png')
    expect(outcome.error).toMatch(/não é anexada automaticamente/)
  })
})
