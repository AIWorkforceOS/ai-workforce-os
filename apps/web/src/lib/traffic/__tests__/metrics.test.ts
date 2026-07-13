// Métricas derivadas, agregação e detectores de sinal.
import { describe, expect, it } from 'vitest'
import {
  aggregate,
  computeDerived,
  detectCpmSpike,
  detectCreativeFatigue,
  detectSpendWithoutConversions,
  pctChange,
  splitRecentVsPrevious,
} from '../metrics'
import type { PlatformMetricsRow } from '../types'

function row(overrides: Partial<PlatformMetricsRow> & { date: string }): PlatformMetricsRow {
  return {
    entity_external_id: 'x',
    entity_level: 'campaign',
    impressions: 1000,
    clicks: 20,
    spend_cents: 5000,
    conversions: 2,
    conversion_value_cents: 20000,
    reach: null,
    frequency: null,
    ...overrides,
  }
}

describe('computeDerived', () => {
  it('calcula CTR, CPC, CPM, CPA e ROAS', () => {
    const derived = computeDerived({
      impressions: 10000,
      clicks: 200,
      spend_cents: 40000, // R$400
      conversions: 10,
      conversion_value_cents: 120000, // R$1200
    })
    expect(derived.ctr).toBe(2) // 200/10000 = 2%
    expect(derived.cpc_cents).toBe(200) // R$2,00
    expect(derived.cpm_cents).toBe(4000) // R$40,00
    expect(derived.cpa_cents).toBe(4000) // R$40,00
    expect(derived.roas).toBe(3)
  })

  it('retorna null quando o denominador é zero (nunca divide por zero)', () => {
    const derived = computeDerived({
      impressions: 0,
      clicks: 0,
      spend_cents: 0,
      conversions: 0,
      conversion_value_cents: 0,
    })
    expect(derived.ctr).toBeNull()
    expect(derived.cpc_cents).toBeNull()
    expect(derived.cpm_cents).toBeNull()
    expect(derived.cpa_cents).toBeNull()
    expect(derived.roas).toBeNull()
  })
})

describe('aggregate / splitRecentVsPrevious', () => {
  it('agrega totais e conta dias distintos', () => {
    const agg = aggregate([
      row({ date: '2026-07-10' }),
      row({ date: '2026-07-11' }),
      row({ date: '2026-07-11' }), // segunda entidade no mesmo dia
    ])
    expect(agg.spend_cents).toBe(15000)
    expect(agg.conversions).toBe(6)
    expect(agg.days).toBe(2)
  })

  it('divide o período em metade recente × anterior', () => {
    const rows = [
      row({ date: '2026-07-01', spend_cents: 1000 }),
      row({ date: '2026-07-02', spend_cents: 1000 }),
      row({ date: '2026-07-03', spend_cents: 9000 }),
      row({ date: '2026-07-04', spend_cents: 9000 }),
    ]
    const { recent, previous } = splitRecentVsPrevious(rows)
    expect(previous.spend_cents).toBe(2000)
    expect(recent.spend_cents).toBe(18000)
  })
})

describe('detectores de sinal', () => {
  it('pctChange lida com null e zero', () => {
    expect(pctChange(120, 100)).toBe(20)
    expect(pctChange(null, 100)).toBeNull()
    expect(pctChange(100, 0)).toBeNull()
  })

  it('fadiga exige frequência alta E queda de CTR', () => {
    const base = aggregate([row({ date: '2026-07-01', impressions: 10000, clicks: 300 })])
    const tired = {
      ...aggregate([row({ date: '2026-07-08', impressions: 10000, clicks: 150 })]),
      frequency: 4.2,
    }
    // frequência alta + CTR -50% → fadiga
    expect(
      detectCreativeFatigue({ recent: tired, previous: base, frequencyThreshold: 3.5, ctrDecayPct: 25 }),
    ).not.toBeNull()
    // frequência baixa → sem fadiga mesmo com CTR caindo
    expect(
      detectCreativeFatigue({
        recent: { ...tired, frequency: 1.5 },
        previous: base,
        frequencyThreshold: 3.5,
        ctrDecayPct: 25,
      }),
    ).toBeNull()
  })

  it('detecta salto de CPM acima do limiar', () => {
    const previous = aggregate([row({ date: '2026-07-01', impressions: 10000, spend_cents: 10000 })])
    const spiked = aggregate([row({ date: '2026-07-08', impressions: 10000, spend_cents: 16000 })])
    const spike = detectCpmSpike({ recent: spiked, previous, spikePct: 40 })
    expect(spike).not.toBeNull()
    expect(spike!.cpmIncreasePct).toBe(60)
  })

  it('alerta gasto sem conversão apenas com volume relevante', () => {
    const noConv = aggregate([
      row({ date: '2026-07-08', conversions: 0, conversion_value_cents: 0, clicks: 80, spend_cents: 20000 }),
    ])
    expect(detectSpendWithoutConversions({ recent: noConv, minSpendCents: 10000 })).not.toBeNull()
    // gasto abaixo do mínimo → sem alerta
    expect(detectSpendWithoutConversions({ recent: noConv, minSpendCents: 50000 })).toBeNull()
    // poucos cliques → sem alerta (sinal fraco)
    const fewClicks = aggregate([
      row({ date: '2026-07-08', conversions: 0, conversion_value_cents: 0, clicks: 5, spend_cents: 20000 }),
    ])
    expect(detectSpendWithoutConversions({ recent: fewClicks, minSpendCents: 10000 })).toBeNull()
  })
})
