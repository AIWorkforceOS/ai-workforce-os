// Motor de estratégia contra o cenário mockado (respostas reais das APIs).
import { describe, expect, it } from 'vitest'
import { normalizeMetaCampaign, normalizeMetaInsights } from '../meta-ads'
import { normalizeGoogleCampaign, normalizeGoogleMetrics } from '../google-ads'
import {
  buildMockGoogleMetrics,
  buildMockMetaInsights,
  MOCK_GOOGLE_CAMPAIGNS,
  MOCK_META_CAMPAIGNS,
} from '../mock-data'
import { classifyFunnelStage, evaluateAccount } from '../strategy-engine'
import type { PlatformEntity, PlatformMetricsRow, StrategyConfig } from '../types'

const STRATEGY: StrategyConfig = {
  target_cpa_cents: 3000, // CPA alvo R$30
  target_roas: 3,
  max_budget_change_pct: 20,
  max_daily_budget_cents: 50000,
}

function groupByEntity(rows: PlatformMetricsRow[]): Map<string, PlatformMetricsRow[]> {
  const map = new Map<string, PlatformMetricsRow[]>()
  for (const row of rows) {
    const list = map.get(row.entity_external_id) ?? []
    list.push(row)
    map.set(row.entity_external_id, list)
  }
  return map
}

describe('classifyFunnelStage', () => {
  it('classifica objetivos Meta e Google', () => {
    expect(classifyFunnelStage('OUTCOME_SALES')).toBe('conversion')
    expect(classifyFunnelStage('OUTCOME_ENGAGEMENT')).toBe('consideration')
    expect(classifyFunnelStage('OUTCOME_AWARENESS')).toBe('awareness')
    expect(classifyFunnelStage('SEARCH')).toBe('conversion')
    expect(classifyFunnelStage('PERFORMANCE_MAX')).toBe('conversion')
    expect(classifyFunnelStage('VIDEO')).toBe('awareness')
    expect(classifyFunnelStage(null)).toBeNull()
  })
})

describe('motor de estratégia — cenário Meta mockado', () => {
  const entities: PlatformEntity[] = MOCK_META_CAMPAIGNS.map(normalizeMetaCampaign)
  const metrics = buildMockMetaInsights().map((row) => normalizeMetaInsights(row, 'campaign'))
  const proposals = evaluateAccount({
    entities,
    metricsByEntity: groupByEntity(metrics),
    strategy: STRATEGY,
  })

  it('pausa a campanha com CPA estourado, com rationale legível', () => {
    const pause = proposals.find(
      (p) => p.decision_type === 'pause_entity' && p.entity_external_id === '120210000000000002',
    )
    expect(pause).toBeDefined()
    expect(pause!.severity).toBe('critical')
    expect(pause!.recommended_action.set_status).toBe('PAUSED')
    expect(pause!.reasoning).toContain('CPA')
    expect(pause!.reasoning).toContain('Compra Broad')
  })

  it('escala o orçamento da campanha com ROAS alto, respeitando o teto de +20%', () => {
    const increase = proposals.find(
      (p) => p.decision_type === 'increase_budget' && p.entity_external_id === '120210000000000001',
    )
    expect(increase).toBeDefined()
    // R$150,00 → +20% = R$180,00 (18000 centavos)
    expect(increase!.recommended_action.set_daily_budget_cents).toBe(18000)
    expect(increase!.reasoning).toContain('ROAS')
  })

  it('detecta fadiga de criativo (frequência alta + CTR caindo)', () => {
    const fatigue = proposals.find(
      (p) => p.decision_type === 'refresh_creative' && p.entity_external_id === '120210000000000003',
    )
    expect(fatigue).toBeDefined()
    expect(fatigue!.recommended_action.advisory_only).toBe(true)
  })

  it('propõe realocação quando há forte e fraco simultâneos', () => {
    expect(proposals.some((p) => p.decision_type === 'reallocate_budget')).toBe(true)
  })

  it('só propõe ações executáveis com payload válido', () => {
    for (const proposal of proposals) {
      const action = proposal.recommended_action
      const executable = Boolean(action.set_status || action.set_daily_budget_cents)
      expect(executable || action.advisory_only).toBe(true)
    }
  })

  it('toda proposta carrega rationale e contexto de métricas', () => {
    for (const proposal of proposals) {
      expect(proposal.reasoning.length).toBeGreaterThan(40)
      expect(Object.keys(proposal.metrics_context).length).toBeGreaterThan(0)
    }
  })
})

describe('motor de estratégia — cenário Google mockado', () => {
  const entities = MOCK_GOOGLE_CAMPAIGNS.map(normalizeGoogleCampaign).filter(
    (entity): entity is PlatformEntity => entity !== null,
  )
  const metrics = buildMockGoogleMetrics()
    .map(normalizeGoogleMetrics)
    .filter((row): row is PlatformMetricsRow => row !== null)
  const proposals = evaluateAccount({
    entities,
    metricsByEntity: groupByEntity(metrics),
    strategy: STRATEGY,
  })

  it('alerta anomalia de CPM na campanha com leilão encarecendo', () => {
    const anomaly = proposals.find(
      (p) => p.decision_type === 'anomaly_alert' && p.entity_external_id === '20002',
    )
    expect(anomaly).toBeDefined()
    expect(anomaly!.reasoning).toContain('CPM')
  })

  it('reconhece a campanha saudável de marca (ROAS 6) como candidata a escala', () => {
    const increase = proposals.find(
      (p) => p.decision_type === 'increase_budget' && p.entity_external_id === '20001',
    )
    expect(increase).toBeDefined()
  })

  it('não sugere pausa para campanha dentro do alvo', () => {
    expect(
      proposals.some((p) => p.decision_type === 'pause_entity' && p.entity_external_id === '20001'),
    ).toBe(false)
  })
})

describe('guard-rails de orçamento', () => {
  it('clampa o aumento no máximo configurado (max_daily_budget_cents)', () => {
    const entities: PlatformEntity[] = [
      {
        ...normalizeMetaCampaign(MOCK_META_CAMPAIGNS[0]!),
        daily_budget_cents: 49000, // perto do teto de 50000
      },
    ]
    const metrics = buildMockMetaInsights()
      .map((row) => normalizeMetaInsights(row, 'campaign'))
      .filter((row) => row.entity_external_id === '120210000000000001')

    const proposals = evaluateAccount({
      entities,
      metricsByEntity: groupByEntity(metrics),
      strategy: STRATEGY,
    })
    const increase = proposals.find((p) => p.decision_type === 'increase_budget')
    expect(increase).toBeDefined()
    expect(increase!.recommended_action.set_daily_budget_cents).toBe(50000) // teto, não 58800
  })

  it('ignora entidades não geridas (is_managed=false)', () => {
    const entities = MOCK_META_CAMPAIGNS.map(normalizeMetaCampaign).map((entity) => ({
      ...entity,
      is_managed: false,
    }))
    const metrics = buildMockMetaInsights().map((row) => normalizeMetaInsights(row, 'campaign'))

    const proposals = evaluateAccount({
      entities,
      metricsByEntity: groupByEntity(metrics),
      strategy: STRATEGY,
    })
    // sem entidades geridas, só sobram análises de conta (funil), nunca pausa/orçamento
    expect(proposals.some((p) => ['pause_entity', 'increase_budget', 'decrease_budget'].includes(p.decision_type))).toBe(false)
  })
})
