// Ativação automática após aprovação (activation.ts) — pedido do Vinicius,
// 2026-08-23: "o humano só clica autorizando e ele já inicia". Mesmo estilo
// de mock de fetch/supabase de launcher.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { activateLaunchedCampaign } from '../activation'
import type { AdAccount, CampaignLaunchOutcome } from '../types'

beforeEach(() => {
  vi.stubEnv('META_SYSTEM_USER_TOKEN', '')
  vi.stubEnv('GOOGLE_ADS_DEVELOPER_TOKEN', '')
  vi.stubEnv('GOOGLE_ADS_CLIENT_ID', '')
  vi.stubEnv('GOOGLE_ADS_CLIENT_SECRET', '')
  vi.stubEnv('GOOGLE_ADS_REFRESH_TOKEN', '')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
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
    optimization_mode: 'suggestion',
    strategy: {},
    last_synced_at: null,
    is_active: true,
    connection_error: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function successOutcome(overrides: Partial<CampaignLaunchOutcome> = {}): CampaignLaunchOutcome {
  return {
    result: 'success',
    campaignExternalId: 'camp_1',
    adSetExternalId: 'adset_1',
    adExternalId: 'ad_1',
    steps: [],
    ...overrides,
  }
}

type FakeCall = { table: string; op: string; filters: Record<string, unknown>; payload?: unknown }

function makeFakeSupabase() {
  const calls: FakeCall[] = []
  const raw = {
    from(table: string) {
      const filters: Record<string, unknown> = {}
      const builder = {
        update(payload: unknown) {
          calls.push({ table, op: 'update', filters, payload })
          return builder
        },
        eq(key: string, value: unknown) {
          filters[key] = value
          return builder
        },
        in(key: string, value: unknown) {
          filters[key] = value
          return Promise.resolve({ data: null, error: null })
        },
      }
      return builder
    },
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- lightweight fake, shape intentionally narrower than SupabaseClient
  const client = raw as any
  return { client, calls }
}

describe('activateLaunchedCampaign — Meta', () => {
  it('ativa campanha, conjunto e anúncio (os 3 níveis) e reflete ACTIVE em ad_entities', async () => {
    const calledUrls: { url: string; body: string }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calledUrls.push({ url, body: (init?.body as URLSearchParams)?.toString() ?? '' })
        return { ok: true, json: async () => ({ success: true }) }
      }),
    )
    const { client, calls } = makeFakeSupabase()

    await activateLaunchedCampaign(client, {
      account: baseAccount({ platform: 'meta', access_token: 'token123' }),
      outcome: successOutcome(),
    })

    expect(calledUrls).toHaveLength(3)
    expect(calledUrls[0]!.url).toContain('camp_1')
    expect(calledUrls[1]!.url).toContain('adset_1')
    expect(calledUrls[2]!.url).toContain('ad_1')
    expect(calledUrls.every((c) => c.body.includes('status=ACTIVE'))).toBe(true)

    const updateCall = calls.find((c) => c.table === 'ad_entities' && c.op === 'update')
    expect(updateCall).toBeTruthy()
    expect(updateCall!.payload).toEqual({ status: 'ACTIVE' })
    expect(updateCall!.filters.ad_account_id).toBe('account_1')
    expect(updateCall!.filters.external_id).toEqual(['camp_1', 'adset_1', 'ad_1'])
  })

  it('lançamento parcial (sem anúncio, ex: sem Página do Facebook): ativa só campanha+conjunto', async () => {
    const calledUrls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calledUrls.push(url)
        return { ok: true, json: async () => ({ success: true }) }
      }),
    )
    const { client } = makeFakeSupabase()

    await activateLaunchedCampaign(client, {
      account: baseAccount({ platform: 'meta', access_token: 'token123' }),
      outcome: successOutcome({ result: 'partial', adExternalId: null }),
    })

    expect(calledUrls).toHaveLength(2)
  })

  it('credenciais ausentes: lança erro claro, nunca chama fetch', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { client } = makeFakeSupabase()

    await expect(
      activateLaunchedCampaign(client, {
        account: baseAccount({ platform: 'meta', access_token: null }),
        outcome: successOutcome(),
      }),
    ).rejects.toThrow('Credenciais Meta')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('falha da plataforma na ativação propaga o erro (chamador decide como tratar)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'permissão negada' } }) })))
    const { client } = makeFakeSupabase()

    await expect(
      activateLaunchedCampaign(client, {
        account: baseAccount({ platform: 'meta', access_token: 'token123' }),
        outcome: successOutcome(),
      }),
    ).rejects.toThrow('permissão negada')
  })
})

describe('activateLaunchedCampaign — Google', () => {
  it('ativa só o nível de campanha (limitação documentada — ad group/ad não têm setter nesta rodada)', async () => {
    const calledUrls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calledUrls.push(url)
        if (url.includes('oauth2')) return { ok: true, json: async () => ({ access_token: 'gtoken' }) }
        return { ok: true, json: async () => ({ results: [{ resourceName: 'customers/1/campaigns/camp_1' }] }) }
      }),
    )
    const { client, calls } = makeFakeSupabase()

    await activateLaunchedCampaign(client, {
      account: baseAccount({
        platform: 'google',
        refresh_token: 'refresh1',
        google_developer_token: 'dev',
        google_client_id: 'cid',
        google_client_secret: 'csecret',
        external_account_id: '1234567890',
      }),
      outcome: successOutcome({ campaignExternalId: 'camp_1', adSetExternalId: 'adgroup_1', adExternalId: 'ad_1' }),
    })

    const updateCall = calls.find((c) => c.table === 'ad_entities' && c.op === 'update')
    expect(updateCall!.filters.external_id).toEqual(['camp_1'])
  })

  it('sem campanha criada (falha antes do primeiro passo), não faz nada', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { client, calls } = makeFakeSupabase()

    await activateLaunchedCampaign(client, {
      account: baseAccount({ platform: 'google', refresh_token: 'refresh1', google_developer_token: 'dev', google_client_id: 'cid', google_client_secret: 'csecret' }),
      outcome: successOutcome({ campaignExternalId: null, adSetExternalId: null, adExternalId: null, result: 'partial' }),
    })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(calls.find((c) => c.table === 'ad_entities')).toBeUndefined()
  })
})
