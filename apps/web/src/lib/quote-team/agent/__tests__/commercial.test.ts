import { describe, expect, it } from 'vitest'
import { computeCommercial, roundMicros, type RateCardInput } from '../commercial'
import { createCostingHandler, materialsTotalFromPricing } from '../costing'
import { diagnosisFixture, materialsFixture, stageContext } from './helpers'

// Os valores abaixo são DADOS DO TESTE (a regra da MAWI cadastrada pelo admin); nenhum deles existe no código de produção.
const card = (over: Partial<RateCardInput> = {}): RateCardInput => ({ id: 'rc1', billed_hourly_rate: 40, technician_hourly_pay: 20, min_billable_hours: null, travel_fee_flat: null, travel_fee_hourly: null, materials_markup_pct: null, tax_rules: null, rounding_rule: null, ...over })
const base = { manHours: 4, travelHours: null, materialsMicros: 0, materialsPartial: false }

describe('computeCommercial (micro-dólares, só admin)', () => {
  it('2 técnicos × 2 h = 4 horas-homem: cobrado US$ 160, custo interno US$ 80, margem US$ 80', () => {
    const r = computeCommercial({ ...base, rateCard: card() })
    expect(r.billed_labor_micros).toBe(160_000_000)
    expect(r.internal_labor_cost_micros).toBe(80_000_000)
    expect(r.margin_micros).toBe(80_000_000)
    expect(r.commercial_total_micros).toBe(160_000_000)
    expect(r.partial).toBe(false)
  })
  it('nenhuma regra opcional é aplicada sem configuração (sem hora mínima, deslocamento, markup nem imposto)', () => {
    const r = computeCommercial({ ...base, manHours: 1, materialsMicros: 10_000_000, rateCard: card() })
    expect(r.travel_micros).toBeNull()
    expect(r.materials_markup_micros).toBeNull()
    expect(r.taxes_micros).toBeNull()
    expect(r.commercial_total_micros).toBe(40_000_000 + 10_000_000)
  })
  it('hora mínima só se configurada (cobra o mínimo, custo interno segue as horas reais)', () => {
    const r = computeCommercial({ ...base, manHours: 1, rateCard: card({ min_billable_hours: 2 }) })
    expect(r.billed_labor_micros).toBe(80_000_000)
    expect(r.internal_labor_cost_micros).toBe(20_000_000)
    expect(r.notes.join(' ')).toMatch(/hora mínima/i)
  })
  it('deslocamento, markup e imposto percentual quando configurados; imposto em formato desconhecido NÃO é calculado', () => {
    const r = computeCommercial({ ...base, manHours: 2, travelHours: 1, materialsMicros: 100_000_000, rateCard: card({ travel_fee_flat: 15, travel_fee_hourly: 10, materials_markup_pct: 20, tax_rules: { pct: 10 } }) })
    expect(r.travel_micros).toBe(25_000_000)
    expect(r.materials_markup_micros).toBe(20_000_000)
    // pré-imposto: 80 (mão de obra) + 25 + 100 + 20 = 225 → imposto 22,5
    expect(r.taxes_micros).toBe(22_500_000)
    expect(r.commercial_total_micros).toBe(247_500_000)
    const unknown = computeCommercial({ ...base, rateCard: card({ tax_rules: { state: 'AZ' } }) })
    expect(unknown.taxes_micros).toBeNull()
    expect(unknown.notes.join(' ')).toMatch(/imposto/i)
  })
  it('sem valor/hora cobrado: não inventa mão de obra e marca parcial', () => {
    const r = computeCommercial({ ...base, rateCard: card({ billed_hourly_rate: null }) })
    expect(r.billed_labor_micros).toBeNull()
    expect(r.partial).toBe(true)
  })
  it('materiais com preço pendente marcam o total como parcial', () => {
    expect(computeCommercial({ ...base, materialsPartial: true, rateCard: card() }).partial).toBe(true)
  })
  it('precisão: valores quebrados não são arredondados no meio do cálculo; só pela regra explícita', () => {
    const raw = computeCommercial({ ...base, manHours: 1.333, rateCard: card({ billed_hourly_rate: 40.1 }) })
    expect(raw.billed_labor_micros).toBe(Math.round(1.333 * 40_100_000))
    expect(roundMicros(1_234_567, 'cent_half_up')).toBe(1_230_000)
    expect(roundMicros(1_234_567, 'cent_up')).toBe(1_240_000)
    expect(roundMicros(1_234_567, 'cent_down')).toBe(1_230_000)
    expect(roundMicros(1_500_000, 'dollar_half_up')).toBe(2_000_000)
    expect(roundMicros(1_234_567, null)).toBe(1_234_567)
  })
})

describe('materialsTotalFromPricing', () => {
  it('soma só itens com preço verificado e marca parcial se faltar algum; ferramenta não entra', () => {
    const materials = { items: materialsFixture([{ name_en: 'A', quantity: 2 }, { name_en: 'B' }, { name_en: 'Tool', kind: 'tool' }]).items } as never
    const pricing = { enabled: true, searches: 1, cost_usd: 0, items: [{ index: 0, name_en: 'A', status: 'verified', reason: null, options: [{ price: 12.5, verified: true }], selected: 0, checked_at: '' }, { index: 1, name_en: 'B', status: 'pending', reason: null, options: [], selected: null, checked_at: '' }] } as never
    expect(materialsTotalFromPricing(materials, pricing)).toEqual({ micros: 25_000_000, partial: true })
  })
})

describe('createCostingHandler', () => {
  const labor = { labor: { technicians: 2, service_hours: 2, travel_hours: null }, man_hours: 4 }
  it('sem regra cadastrada: pula (nada é inventado)', async () => {
    const { ctx } = await stageContext({ stepResults: { labor } })
    const out = await createCostingHandler({ loadRateCard: async () => null }).run(ctx)
    expect((out as { result: { skipped: string } }).result.skipped).toBe('no_rate_card')
  })
  it('com regra: calcula usando a mão de obra e os materiais; a regra vem do servidor', async () => {
    const { ctx } = await stageContext({ stepResults: { labor, diagnosis: { diagnosis: diagnosisFixture() } } })
    const out = await createCostingHandler({ loadRateCard: async () => card() }).run(ctx)
    expect((out as { result: { commercial: { billed_labor_micros: number } } }).result.commercial.billed_labor_micros).toBe(160_000_000)
  })
})
