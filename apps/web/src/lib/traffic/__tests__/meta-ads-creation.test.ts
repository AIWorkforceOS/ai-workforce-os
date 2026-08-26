// Criação de campanha na Meta — cobre a montagem do payload (contrato da
// chamada, conformidade com a doc oficial), NÃO o comportamento real da
// API (isso só um teste com conta de verdade confirma).
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createMetaAd,
  createMetaAdCreative,
  createMetaAdSet,
  createMetaCampaign,
  createMetaLeadForm,
  metaOptimizationGoalFor,
  type MetaConfig,
} from '../meta-ads'

const config: MetaConfig = { accessToken: 'token123', adAccountId: 'act_999' }

function mockFetchOnce(body: unknown, ok = true) {
  const fetchMock = vi.fn(async () => ({ ok, json: async () => body }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function lastRequestBody(fetchMock: ReturnType<typeof vi.fn>): URLSearchParams {
  const call = fetchMock.mock.calls[fetchMock.mock.calls.length - 1]!
  return call[1].body as URLSearchParams
}

function lastRequestUrl(fetchMock: ReturnType<typeof vi.fn>): string {
  const call = fetchMock.mock.calls[fetchMock.mock.calls.length - 1]!
  return call[0] as string
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('metaOptimizationGoalFor', () => {
  it('OUTCOME_SALES com pixel configurado → OFFSITE_CONVERSIONS', () => {
    expect(metaOptimizationGoalFor('OUTCOME_SALES', true)).toBe('OFFSITE_CONVERSIONS')
  })

  it('OUTCOME_SALES sem pixel → cai para LINK_CLICKS (otimiza por clique, não por conversão)', () => {
    expect(metaOptimizationGoalFor('OUTCOME_SALES', false)).toBe('LINK_CLICKS')
  })

  it('OUTCOME_LEADS sem pixel → LINK_CLICKS', () => {
    expect(metaOptimizationGoalFor('OUTCOME_LEADS', false)).toBe('LINK_CLICKS')
  })

  it('OUTCOME_AWARENESS → REACH', () => {
    expect(metaOptimizationGoalFor('OUTCOME_AWARENESS', false)).toBe('REACH')
  })

  it('OUTCOME_ENGAGEMENT → POST_ENGAGEMENT', () => {
    expect(metaOptimizationGoalFor('OUTCOME_ENGAGEMENT', false)).toBe('POST_ENGAGEMENT')
  })

  it('objetivo desconhecido cai no fallback seguro LINK_CLICKS', () => {
    expect(metaOptimizationGoalFor('ALGO_NOVO_DA_META', false)).toBe('LINK_CLICKS')
  })

  it('regressão (2026-08-27): OUTCOME_LEADS com useNativeLeadForm=true → LEAD_GENERATION, mesmo sem pixel', () => {
    expect(metaOptimizationGoalFor('OUTCOME_LEADS', false, true)).toBe('LEAD_GENERATION')
  })

  it('OUTCOME_LEADS com pixel mas SEM formulário nativo continua caindo em OFFSITE_CONVERSIONS (comportamento anterior)', () => {
    expect(metaOptimizationGoalFor('OUTCOME_LEADS', true, false)).toBe('OFFSITE_CONVERSIONS')
  })
})

describe('createMetaLeadForm (2026-08-27, formulário nativo de leads)', () => {
  it('cria o formulário na PÁGINA (não na conta de anúncios) com os 3 campos padrão que o webhook de recebimento sabe extrair', async () => {
    const fetchMock = mockFetchOnce({ id: 'form_1' })
    const result = await createMetaLeadForm(config, { pageId: 'page_1', name: 'Campanha X — Formulário' })

    expect(result).toEqual({ id: 'form_1' })
    expect(lastRequestUrl(fetchMock)).toContain('page_1/leadgen_forms')
    expect(lastRequestUrl(fetchMock)).not.toContain('act_999')
    const body = lastRequestBody(fetchMock)
    expect(body.get('name')).toBe('Campanha X — Formulário')
    expect(JSON.parse(body.get('questions')!)).toEqual([{ type: 'FULL_NAME' }, { type: 'EMAIL' }, { type: 'PHONE' }])
  })
})

describe('createMetaCampaign', () => {
  it('nasce PAUSED por padrão e sem special_ad_categories', async () => {
    const fetchMock = mockFetchOnce({ id: 'camp_1' })
    const result = await createMetaCampaign(config, { name: 'Campanha Teste', objective: 'OUTCOME_SALES' })

    expect(result).toEqual({ id: 'camp_1' })
    const body = lastRequestBody(fetchMock)
    expect(body.get('name')).toBe('Campanha Teste')
    expect(body.get('objective')).toBe('OUTCOME_SALES')
    expect(body.get('status')).toBe('PAUSED')
    expect(JSON.parse(body.get('special_ad_categories')!)).toEqual([])
    expect(lastRequestUrl(fetchMock)).toContain('act_999/campaigns')
  })

  it('respeita status explícito', async () => {
    const fetchMock = mockFetchOnce({ id: 'camp_2' })
    await createMetaCampaign(config, { name: 'X', objective: 'OUTCOME_TRAFFIC', status: 'ACTIVE' })
    expect(lastRequestBody(fetchMock).get('status')).toBe('ACTIVE')
  })
})

describe('createMetaAdSet', () => {
  it('monta geo/idade/interesses e orçamento em centavos', async () => {
    const fetchMock = mockFetchOnce({ id: 'adset_1' })
    await createMetaAdSet(config, {
      name: 'Conjunto 1',
      campaignId: 'camp_1',
      dailyBudgetCents: 15000,
      optimizationGoal: 'LINK_CLICKS',
      targeting: { countries: ['BR'], ageMin: 25, ageMax: 45, interestIds: ['6003107902433'] },
    })
    const body = lastRequestBody(fetchMock)
    expect(body.get('campaign_id')).toBe('camp_1')
    expect(body.get('daily_budget')).toBe('15000')
    expect(body.get('optimization_goal')).toBe('LINK_CLICKS')
    expect(body.get('status')).toBe('PAUSED')

    const targeting = JSON.parse(body.get('targeting')!)
    expect(targeting.geo_locations.countries).toEqual(['BR'])
    expect(targeting.age_min).toBe(25)
    expect(targeting.age_max).toBe(45)
    expect(targeting.flexible_spec).toEqual([{ interests: [{ id: '6003107902433' }] }])
  })

  it('usa idade padrão 18–65 e omite flexible_spec sem interesses', async () => {
    const fetchMock = mockFetchOnce({ id: 'adset_2' })
    await createMetaAdSet(config, {
      name: 'Conjunto 2',
      campaignId: 'camp_1',
      dailyBudgetCents: 5000,
      optimizationGoal: 'REACH',
      targeting: { countries: ['US'] },
    })
    const targeting = JSON.parse(lastRequestBody(fetchMock).get('targeting')!)
    expect(targeting.age_min).toBe(18)
    expect(targeting.age_max).toBe(65)
    expect(targeting.flexible_spec).toBeUndefined()
  })

  it('só envia promoted_object (pixel) quando optimization_goal é OFFSITE_CONVERSIONS', async () => {
    const fetchMock = mockFetchOnce({ id: 'adset_3' })
    await createMetaAdSet(config, {
      name: 'Conjunto 3',
      campaignId: 'camp_1',
      dailyBudgetCents: 5000,
      optimizationGoal: 'OFFSITE_CONVERSIONS',
      targeting: { countries: ['BR'] },
      promotedObjectPixelId: 'pixel_123',
    })
    expect(JSON.parse(lastRequestBody(fetchMock).get('promoted_object')!)).toEqual({
      pixel_id: 'pixel_123',
      custom_event_type: 'PURCHASE',
    })
  })

  it('não envia promoted_object fora de OFFSITE_CONVERSIONS mesmo com pixel informado', async () => {
    const fetchMock = mockFetchOnce({ id: 'adset_4' })
    await createMetaAdSet(config, {
      name: 'Conjunto 4',
      campaignId: 'camp_1',
      dailyBudgetCents: 5000,
      optimizationGoal: 'LINK_CLICKS',
      targeting: { countries: ['BR'] },
      promotedObjectPixelId: 'pixel_123',
    })
    expect(lastRequestBody(fetchMock).get('promoted_object')).toBeNull()
  })

  it('regressão (2026-08-27): LEAD_GENERATION envia promoted_object com page_id (não pixel_id) e destination_type=ON_AD', async () => {
    const fetchMock = mockFetchOnce({ id: 'adset_5' })
    await createMetaAdSet(config, {
      name: 'Conjunto 5',
      campaignId: 'camp_1',
      dailyBudgetCents: 5000,
      optimizationGoal: 'LEAD_GENERATION',
      targeting: { countries: ['BR'] },
      promotedObjectPageId: 'page_1',
      destinationType: 'ON_AD',
    })
    const body = lastRequestBody(fetchMock)
    expect(JSON.parse(body.get('promoted_object')!)).toEqual({ page_id: 'page_1' })
    expect(body.get('destination_type')).toBe('ON_AD')
  })
})

describe('createMetaAdCreative', () => {
  it('monta object_story_spec com Página, mensagem, link e CTA padrão LEARN_MORE', async () => {
    const fetchMock = mockFetchOnce({ id: 'creative_1' })
    await createMetaAdCreative(config, {
      name: 'Criativo 1',
      pageId: 'page_1',
      message: 'Corpo do anúncio',
      linkUrl: 'https://example.com',
      headline: 'Título',
    })
    const spec = JSON.parse(lastRequestBody(fetchMock).get('object_story_spec')!)
    expect(spec.page_id).toBe('page_1')
    expect(spec.link_data.message).toBe('Corpo do anúncio')
    expect(spec.link_data.link).toBe('https://example.com')
    expect(spec.link_data.name).toBe('Título')
    expect(spec.link_data.call_to_action).toEqual({ type: 'LEARN_MORE' })
  })

  it('usa CTA explícito quando informado', async () => {
    const fetchMock = mockFetchOnce({ id: 'creative_2' })
    await createMetaAdCreative(config, {
      name: 'Criativo 2',
      pageId: 'page_1',
      message: 'X',
      linkUrl: 'https://example.com',
      callToActionType: 'SHOP_NOW',
    })
    const spec = JSON.parse(lastRequestBody(fetchMock).get('object_story_spec')!)
    expect(spec.link_data.call_to_action).toEqual({ type: 'SHOP_NOW' })
  })

  it('inclui picture no link_data quando imageUrl é informada', async () => {
    const fetchMock = mockFetchOnce({ id: 'creative_3' })
    await createMetaAdCreative(config, {
      name: 'Criativo 3',
      pageId: 'page_1',
      message: 'X',
      linkUrl: 'https://example.com',
      imageUrl: 'https://storage.example.com/unit-1/traffic/img.png',
    })
    const spec = JSON.parse(lastRequestBody(fetchMock).get('object_story_spec')!)
    expect(spec.link_data.picture).toBe('https://storage.example.com/unit-1/traffic/img.png')
  })

  it('omite picture quando imageUrl não é informada (comportamento anterior)', async () => {
    const fetchMock = mockFetchOnce({ id: 'creative_4' })
    await createMetaAdCreative(config, {
      name: 'Criativo 4',
      pageId: 'page_1',
      message: 'X',
      linkUrl: 'https://example.com',
    })
    const spec = JSON.parse(lastRequestBody(fetchMock).get('object_story_spec')!)
    expect(spec.link_data.picture).toBeUndefined()
  })

  it('regressão (2026-08-27): com leadGenFormId, usa call_to_action SIGN_UP com o form id e link=https://fb.me/ (placeholder exigido pela Meta pra anúncio de formulário nativo)', async () => {
    const fetchMock = mockFetchOnce({ id: 'creative_5' })
    await createMetaAdCreative(config, {
      name: 'Criativo 5',
      pageId: 'page_1',
      message: 'X',
      linkUrl: 'https://minha-landing-normal.com', // ignorado quando leadGenFormId está presente
      leadGenFormId: 'form_1',
    })
    const spec = JSON.parse(lastRequestBody(fetchMock).get('object_story_spec')!)
    expect(spec.link_data.link).toBe('https://fb.me/')
    expect(spec.link_data.call_to_action).toEqual({ type: 'SIGN_UP', value: { lead_gen_form_id: 'form_1' } })
  })
})

describe('createMetaAd', () => {
  it('liga ad set ao criativo via creative_id e nasce PAUSED', async () => {
    const fetchMock = mockFetchOnce({ id: 'ad_1' })
    await createMetaAd(config, { name: 'Anúncio 1', adSetId: 'adset_1', creativeId: 'creative_1' })
    const body = lastRequestBody(fetchMock)
    expect(body.get('adset_id')).toBe('adset_1')
    expect(JSON.parse(body.get('creative')!)).toEqual({ creative_id: 'creative_1' })
    expect(body.get('status')).toBe('PAUSED')
  })
})

describe('erro da API', () => {
  it('propaga a mensagem de erro da Meta quando a resposta não é ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, json: async () => ({ error: { message: 'Invalid parameter', code: 100 } }) })),
    )
    await expect(createMetaCampaign(config, { name: 'X', objective: 'OUTCOME_SALES' })).rejects.toThrow(
      /Invalid parameter/,
    )
  })
})
