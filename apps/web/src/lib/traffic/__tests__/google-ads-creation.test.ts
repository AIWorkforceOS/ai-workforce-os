// Criação de campanha no Google Ads — cobre a montagem do payload e a
// ORDEM de dependência entre recursos (budget → campaign → ad group → ad),
// NÃO o comportamento real da API (isso só um teste com conta de verdade
// confirma).
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createGoogleAdGroup,
  createGoogleCampaign,
  createGoogleCampaignBudget,
  createGoogleResponsiveSearchAd,
  type GoogleAdsConfig,
} from '../google-ads'

const config: GoogleAdsConfig = {
  developerToken: 'dev-token',
  clientId: 'client-id',
  clientSecret: 'client-secret',
  refreshToken: 'refresh-token',
  customerId: '1234567890',
  loginCustomerId: null,
}

function mockFetchOnce(body: unknown, ok = true) {
  const fetchMock = vi.fn(async () => ({ ok, json: async () => body }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- payload shape varies per endpoint in these tests
type MutateRequestBody = { operations: { create: any }[] }

function lastRequestBody(fetchMock: ReturnType<typeof vi.fn>): MutateRequestBody {
  const call = fetchMock.mock.calls[fetchMock.mock.calls.length - 1]!
  return JSON.parse(call[1].body as string)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- payload shape varies per endpoint in these tests
function lastCreate(fetchMock: ReturnType<typeof vi.fn>): any {
  return lastRequestBody(fetchMock).operations[0]!.create
}

function lastRequestUrl(fetchMock: ReturnType<typeof vi.fn>): string {
  const call = fetchMock.mock.calls[fetchMock.mock.calls.length - 1]!
  return call[0] as string
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createGoogleCampaignBudget', () => {
  it('converte centavos para micros (×10.000) e usa delivery STANDARD', async () => {
    const fetchMock = mockFetchOnce({ results: [{ resourceName: 'customers/1234567890/campaignBudgets/30001' }] })
    const result = await createGoogleCampaignBudget(config, 'access-token', 'Campanha X', 8000)

    expect(result.resourceName).toBe('customers/1234567890/campaignBudgets/30001')
    const create = lastCreate(fetchMock)
    expect(create.amountMicros).toBe(String(8000 * 10_000))
    expect(create.deliveryMethod).toBe('STANDARD')
    expect(create.name).toContain('Campanha X')
    expect(lastRequestUrl(fetchMock)).toContain('campaignBudgets:mutate')
  })

  it('lança erro claro quando a resposta não traz resourceName', async () => {
    mockFetchOnce({ results: [{}] })
    await expect(createGoogleCampaignBudget(config, 'access-token', 'X', 1000)).rejects.toThrow(/resourceName/)
  })
})

describe('createGoogleCampaign', () => {
  it('referencia o orçamento e usa manualCpc (lance manual) por padrão', async () => {
    const fetchMock = mockFetchOnce({ results: [{ resourceName: 'customers/1234567890/campaigns/20001' }] })
    await createGoogleCampaign(
      config,
      'access-token',
      { name: 'Campanha X', channelType: 'SEARCH' },
      'customers/1234567890/campaignBudgets/30001',
    )
    const create = lastCreate(fetchMock)
    expect(create.campaignBudget).toBe('customers/1234567890/campaignBudgets/30001')
    expect(create.manualCpc).toEqual({ enhancedCpcEnabled: false })
    expect(create.status).toBe('PAUSED')
    expect(create.networkSettings).toEqual({
      targetGoogleSearch: true,
      targetSearchNetwork: false,
      targetContentNetwork: false,
    })
  })

  it('usa o bidding scheme correspondente quando MAXIMIZE_CONVERSIONS é pedido', async () => {
    const fetchMock = mockFetchOnce({ results: [{ resourceName: 'customers/1234567890/campaigns/20002' }] })
    await createGoogleCampaign(
      config,
      'access-token',
      { name: 'Campanha Y', channelType: 'SEARCH', biddingStrategy: 'MAXIMIZE_CONVERSIONS' },
      'customers/1234567890/campaignBudgets/30002',
    )
    const create = lastCreate(fetchMock)
    expect(create.maximizeConversions).toEqual({})
    expect(create.manualCpc).toBeUndefined()
  })

  it('não envia networkSettings de Search para canais fora de SEARCH', async () => {
    const fetchMock = mockFetchOnce({ results: [{ resourceName: 'customers/1234567890/campaigns/20003' }] })
    await createGoogleCampaign(
      config,
      'access-token',
      { name: 'Campanha Display', channelType: 'DISPLAY' },
      'customers/1234567890/campaignBudgets/30003',
    )
    expect(lastCreate(fetchMock).networkSettings).toBeUndefined()
  })
})

describe('createGoogleAdGroup', () => {
  it('referencia a campanha e usa SEARCH_STANDARD por padrão', async () => {
    const fetchMock = mockFetchOnce({ results: [{ resourceName: 'customers/1234567890/adGroups/40001' }] })
    await createGoogleAdGroup(config, 'access-token', { name: 'Grupo 1' }, 'customers/1234567890/campaigns/20001')
    const create = lastCreate(fetchMock)
    expect(create.campaign).toBe('customers/1234567890/campaigns/20001')
    expect(create.type).toBe('SEARCH_STANDARD')
    expect(create.cpcBidMicros).toBeUndefined()
  })

  it('inclui cpcBidMicros só quando lance manual é informado', async () => {
    const fetchMock = mockFetchOnce({ results: [{ resourceName: 'customers/1234567890/adGroups/40002' }] })
    await createGoogleAdGroup(
      config,
      'access-token',
      { name: 'Grupo 2', cpcBidCents: 150 },
      'customers/1234567890/campaigns/20001',
    )
    expect(lastCreate(fetchMock).cpcBidMicros).toBe(String(150 * 10_000))
  })
})

describe('createGoogleResponsiveSearchAd', () => {
  it('exige ao menos 3 headlines', async () => {
    await expect(
      createGoogleResponsiveSearchAd(
        config,
        'access-token',
        { headlines: ['A', 'B'], descriptions: ['C', 'D'], finalUrls: ['https://x.com'] },
        'customers/1234567890/adGroups/40001',
      ),
    ).rejects.toThrow(/3 headlines/)
  })

  it('exige ao menos 2 descriptions', async () => {
    await expect(
      createGoogleResponsiveSearchAd(
        config,
        'access-token',
        { headlines: ['A', 'B', 'C'], descriptions: ['D'], finalUrls: ['https://x.com'] },
        'customers/1234567890/adGroups/40001',
      ),
    ).rejects.toThrow(/2 descriptions/)
  })

  it('monta headlines/descriptions como {text} e referencia o ad group', async () => {
    const fetchMock = mockFetchOnce({ results: [{ resourceName: 'customers/1234567890/adGroupAds/50001' }] })
    await createGoogleResponsiveSearchAd(
      config,
      'access-token',
      { headlines: ['A', 'B', 'C'], descriptions: ['D', 'E'], finalUrls: ['https://x.com'] },
      'customers/1234567890/adGroups/40001',
    )
    const create = lastCreate(fetchMock)
    expect(create.adGroup).toBe('customers/1234567890/adGroups/40001')
    expect(create.ad.responsiveSearchAd.headlines).toEqual([{ text: 'A' }, { text: 'B' }, { text: 'C' }])
    expect(create.ad.responsiveSearchAd.descriptions).toEqual([{ text: 'D' }, { text: 'E' }])
    expect(create.ad.finalUrls).toEqual(['https://x.com'])
  })
})

describe('erro da API', () => {
  it('propaga mensagem de erro do Google quando a resposta não é ok', async () => {
    mockFetchOnce({ error: { message: 'INVALID_ARGUMENT' } }, false)
    await expect(createGoogleCampaignBudget(config, 'access-token', 'X', 1000)).rejects.toThrow(/INVALID_ARGUMENT/)
  })
})
