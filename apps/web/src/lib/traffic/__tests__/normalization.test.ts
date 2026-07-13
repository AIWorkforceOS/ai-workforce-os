// Normalização das respostas das plataformas (shapes reais das APIs).
import { describe, expect, it } from 'vitest'
import {
  normalizeMetaAdSet,
  normalizeMetaCampaign,
  normalizeMetaInsights,
  sumMetaConversions,
  sumMetaConversionValueCents,
} from '../meta-ads'
import {
  centsFromMicros,
  normalizeGoogleCampaign,
  normalizeGoogleMetrics,
} from '../google-ads'
import {
  buildMockGoogleMetrics,
  buildMockMetaInsights,
  MOCK_GOOGLE_CAMPAIGNS,
  MOCK_META_ADSETS,
  MOCK_META_CAMPAIGNS,
} from '../mock-data'

describe('normalização Meta Marketing API (v25.0)', () => {
  it('converte campanha com orçamento em centavos e status normalizado', () => {
    const entity = normalizeMetaCampaign(MOCK_META_CAMPAIGNS[0]!)
    expect(entity.platform).toBe('meta')
    expect(entity.entity_level).toBe('campaign')
    expect(entity.external_id).toBe('120210000000000001')
    expect(entity.status).toBe('ACTIVE')
    expect(entity.daily_budget_cents).toBe(15000) // Meta já devolve centavos
    expect(entity.objective).toBe('OUTCOME_SALES')
  })

  it('vincula ad set à campanha-mãe', () => {
    const entity = normalizeMetaAdSet(MOCK_META_ADSETS[0]!)
    expect(entity.entity_level).toBe('ad_set')
    expect(entity.parent_external_id).toBe('120210000000000001')
  })

  it('converte insights: spend em moeda → centavos, actions → conversões', () => {
    const rows = buildMockMetaInsights()
    const first = rows.find((row) => row.campaign_id === '120210000000000001')!
    const normalized = normalizeMetaInsights(first, 'campaign')

    expect(normalized.entity_external_id).toBe('120210000000000001')
    expect(normalized.spend_cents).toBe(14830) // "148.30" → 14830
    expect(normalized.conversions).toBe(9) // apenas action_type 'purchase' (link_click ignorado)
    expect(normalized.conversion_value_cents).toBe(90500) // "905.00" → 90500
    expect(normalized.frequency).toBeCloseTo(1.53)
  })

  it('soma apenas action_types de conversão', () => {
    expect(
      sumMetaConversions([
        { action_type: 'purchase', value: '3' },
        { action_type: 'lead', value: '2' },
        { action_type: 'link_click', value: '100' },
        { action_type: 'post_engagement', value: '50' },
      ]),
    ).toBe(5)
    expect(
      sumMetaConversionValueCents([
        { action_type: 'purchase', value: '199.90' },
        { action_type: 'link_click', value: '10' },
      ]),
    ).toBe(19990)
  })
})

describe('normalização Google Ads API (v24, GAQL)', () => {
  it('converte micros para centavos', () => {
    expect(centsFromMicros('80000000')).toBe(8000) // R$80,00
    expect(centsFromMicros('118000000')).toBe(11800)
    expect(centsFromMicros(undefined)).toBe(0)
  })

  it('converte campanha com status ENABLED → ACTIVE e orçamento do budget', () => {
    const entity = normalizeGoogleCampaign(MOCK_GOOGLE_CAMPAIGNS[0]!)!
    expect(entity.platform).toBe('google')
    expect(entity.external_id).toBe('20001')
    expect(entity.status).toBe('ACTIVE')
    expect(entity.daily_budget_cents).toBe(8000)
    expect(entity.bid_strategy).toBe('TARGET_CPA')
  })

  it('converte métricas diárias (costMicros, conversions, conversionsValue)', () => {
    const rows = buildMockGoogleMetrics()
    const first = rows.find((row) => row.campaign?.id === '20001')!
    const normalized = normalizeGoogleMetrics(first)!

    expect(normalized.entity_external_id).toBe('20001')
    expect(normalized.spend_cents).toBe(7500)
    expect(normalized.conversions).toBe(3)
    expect(normalized.conversion_value_cents).toBe(45000)
    expect(normalized.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('descarta linhas sem campanha ou sem data', () => {
    expect(normalizeGoogleMetrics({ metrics: { clicks: '10' } })).toBeNull()
    expect(normalizeGoogleCampaign({ campaignBudget: { amountMicros: '1' } })).toBeNull()
  })
})
