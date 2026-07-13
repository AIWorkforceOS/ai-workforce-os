// Cálculo de métricas derivadas, agregação de períodos e sinais
// (fadiga de criativo, anomalias). Funções puras — testáveis sem rede.

import type { AggregatedMetrics, PlatformMetricsRow } from './types'

/** Métricas derivadas de um dia/linha (persistidas no snapshot). */
export function computeDerived(row: {
  impressions: number
  clicks: number
  spend_cents: number
  conversions: number
  conversion_value_cents: number
}): {
  ctr: number | null
  cpc_cents: number | null
  cpm_cents: number | null
  cpa_cents: number | null
  roas: number | null
} {
  const { impressions, clicks, spend_cents, conversions, conversion_value_cents } = row
  return {
    ctr: impressions > 0 ? round4((clicks / impressions) * 100) : null,
    cpc_cents: clicks > 0 ? Math.round(spend_cents / clicks) : null,
    cpm_cents: impressions > 0 ? Math.round((spend_cents / impressions) * 1000) : null,
    cpa_cents: conversions > 0 ? Math.round(spend_cents / conversions) : null,
    roas: spend_cents > 0 ? round4(conversion_value_cents / spend_cents) : null,
  }
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000
}

/** Agrega linhas de métricas de um período em um único bloco com derivadas. */
export function aggregate(rows: PlatformMetricsRow[]): AggregatedMetrics {
  const totals = rows.reduce(
    (acc, row) => ({
      impressions: acc.impressions + row.impressions,
      clicks: acc.clicks + row.clicks,
      spend_cents: acc.spend_cents + row.spend_cents,
      conversions: acc.conversions + row.conversions,
      conversion_value_cents: acc.conversion_value_cents + row.conversion_value_cents,
    }),
    { impressions: 0, clicks: 0, spend_cents: 0, conversions: 0, conversion_value_cents: 0 },
  )

  const frequencies = rows.map((row) => row.frequency).filter((f): f is number => f !== null)
  const derived = computeDerived(totals)

  return {
    ...totals,
    frequency: frequencies.length > 0 ? round4(frequencies.reduce((a, b) => a + b, 0) / frequencies.length) : null,
    ...derived,
    days: new Set(rows.map((row) => row.date)).size,
  }
}

/** Divide as linhas em metade recente × metade anterior (para tendência). */
export function splitRecentVsPrevious(rows: PlatformMetricsRow[]): {
  recent: AggregatedMetrics
  previous: AggregatedMetrics
} {
  const dates = [...new Set(rows.map((row) => row.date))].sort()
  const half = Math.floor(dates.length / 2)
  const recentDates = new Set(dates.slice(half))

  return {
    recent: aggregate(rows.filter((row) => recentDates.has(row.date))),
    previous: aggregate(rows.filter((row) => !recentDates.has(row.date))),
  }
}

/** Variação percentual entre dois valores (null quando não computável). */
export function pctChange(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null
  return round4(((current - previous) / previous) * 100)
}

/**
 * Fadiga de criativo (Meta): frequência média acima do limiar E queda
 * de CTR relevante vs período anterior. Retorna o diagnóstico ou null.
 */
export function detectCreativeFatigue(params: {
  recent: AggregatedMetrics
  previous: AggregatedMetrics
  frequencyThreshold: number
  ctrDecayPct: number
}): { frequency: number; ctrDropPct: number } | null {
  const { recent, previous, frequencyThreshold, ctrDecayPct } = params
  if (recent.frequency === null || recent.frequency < frequencyThreshold) return null

  const ctrDrop = pctChange(recent.ctr, previous.ctr)
  if (ctrDrop === null || ctrDrop > -ctrDecayPct) return null

  return { frequency: recent.frequency, ctrDropPct: Math.abs(ctrDrop) }
}

/**
 * Anomalia de CPM: alta relevante vs período anterior (leilão encarecendo,
 * possível problema de qualidade/segmentação ou sazonalidade de leilão).
 */
export function detectCpmSpike(params: {
  recent: AggregatedMetrics
  previous: AggregatedMetrics
  spikePct: number
}): { cpmIncreasePct: number; recentCpmCents: number } | null {
  const { recent, previous, spikePct } = params
  const increase = pctChange(recent.cpm_cents, previous.cpm_cents)
  if (increase === null || increase < spikePct || recent.cpm_cents === null) return null
  return { cpmIncreasePct: increase, recentCpmCents: recent.cpm_cents }
}

/**
 * Padrão de cliques suspeitos/qualidade de tráfego: CTR razoável mas
 * zero conversão com gasto relevante — pode ser clique inválido, pixel
 * quebrado ou landing page ruim. É um alerta, não uma ação automática.
 */
export function detectSpendWithoutConversions(params: {
  recent: AggregatedMetrics
  minSpendCents: number
}): { spendCents: number; clicks: number } | null {
  const { recent, minSpendCents } = params
  if (recent.spend_cents < minSpendCents) return null
  if (recent.conversions > 0) return null
  if (recent.clicks < 30) return null // volume mínimo para o sinal ser significativo
  return { spendCents: recent.spend_cents, clicks: recent.clicks }
}

export function formatCentsBRL(cents: number | null): string {
  if (cents === null) return '—'
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
