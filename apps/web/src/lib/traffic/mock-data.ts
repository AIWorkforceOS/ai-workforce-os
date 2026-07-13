// Dados mockados representando respostas REAIS das APIs (mesmo shape que
// a Meta Marketing API v25.0 e a Google Ads API v24 devolvem), usados:
//   1. nos testes (apps/web/src/lib/traffic/__tests__)
//   2. no modo demo do cron (TRAFFIC_USE_MOCK=1) para validar o pipeline
//      ponta a ponta antes de existirem credenciais reais.
//
// O cenário foi desenhado para exercitar todas as regras do motor:
//   - "Conversão | Compra Remarketing": ROAS alto → aumentar orçamento
//   - "Conversão | Compra Broad":       CPA estourado → pausar
//   - "Consideração | Vídeo Views":     fadiga de criativo (freq alta + CTR caindo)
//   - "Google | Search Marca":          saudável, sem ação
//   - "Google | PMax Genérica":         CPM disparando (anomalia)
//   - conta 100% em fundo de funil (Meta) → sugestão de rebalanceamento

import type { MetaAdSetRow, MetaCampaignRow, MetaInsightsRow } from './meta-ads'
import type { GoogleAdsSearchRow } from './google-ads'

// ---------------------------------------------------------------------------
// Meta Marketing API — shapes reais de GET /act_X/campaigns, /adsets, /insights
// ---------------------------------------------------------------------------

export const MOCK_META_CAMPAIGNS: MetaCampaignRow[] = [
  {
    id: '120210000000000001',
    name: 'Conversão | Compra Remarketing',
    status: 'ACTIVE',
    effective_status: 'ACTIVE',
    objective: 'OUTCOME_SALES',
    daily_budget: '15000', // R$150,00 (Meta devolve centavos como string)
    bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
  },
  {
    id: '120210000000000002',
    name: 'Conversão | Compra Broad',
    status: 'ACTIVE',
    effective_status: 'ACTIVE',
    objective: 'OUTCOME_SALES',
    daily_budget: '20000',
    bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
  },
  {
    id: '120210000000000003',
    name: 'Consideração | Vídeo Views',
    status: 'ACTIVE',
    effective_status: 'ACTIVE',
    objective: 'OUTCOME_ENGAGEMENT',
    daily_budget: '5000',
    bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
  },
]

export const MOCK_META_ADSETS: MetaAdSetRow[] = [
  {
    id: '120210000000001001',
    campaign_id: '120210000000000001',
    name: 'Remarketing 14d | Lookalike 1%',
    status: 'ACTIVE',
    effective_status: 'ACTIVE',
    objective: 'OUTCOME_SALES',
    daily_budget: '15000',
    bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
  },
  {
    id: '120210000000001002',
    campaign_id: '120210000000000002',
    name: 'Broad 25-55 BR',
    status: 'ACTIVE',
    effective_status: 'ACTIVE',
    objective: 'OUTCOME_SALES',
    daily_budget: '20000',
    bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
  },
]

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

/**
 * Insights diários (time_increment=1, level=campaign) dos últimos 14 dias.
 * Shape idêntico ao retorno real: números como string, actions/action_values
 * como arrays de {action_type, value}.
 */
export function buildMockMetaInsights(): MetaInsightsRow[] {
  const rows: MetaInsightsRow[] = []

  for (let day = 13; day >= 0; day--) {
    const date = isoDaysAgo(day)
    const recentHalf = day < 7 // últimos 7 dias vs 7 anteriores

    // Campanha 1 — remarketing performando MUITO bem (ROAS ~6)
    rows.push({
      campaign_id: '120210000000000001',
      date_start: date,
      date_stop: date,
      impressions: '9500',
      clicks: '210',
      spend: '148.30',
      reach: '6200',
      frequency: '1.53',
      actions: [
        { action_type: 'purchase', value: '9' },
        { action_type: 'link_click', value: '198' },
      ],
      action_values: [{ action_type: 'purchase', value: '905.00' }],
      purchase_roas: [{ action_type: 'omni_purchase', value: '6.10' }],
    })

    // Campanha 2 — broad com CPA estourado (gasta muito, converte pouco)
    rows.push({
      campaign_id: '120210000000000002',
      date_start: date,
      date_stop: date,
      impressions: '22000',
      clicks: '260',
      spend: '198.75',
      reach: '18500',
      frequency: '1.19',
      actions: [
        { action_type: 'purchase', value: '1' },
        { action_type: 'link_click', value: '244' },
      ],
      action_values: [{ action_type: 'purchase', value: '98.00' }],
      purchase_roas: [{ action_type: 'omni_purchase', value: '0.49' }],
    })

    // Campanha 3 — fadiga: frequência alta e CTR desabando na metade recente
    rows.push({
      campaign_id: '120210000000000003',
      date_start: date,
      date_stop: date,
      impressions: '15000',
      clicks: recentHalf ? '90' : '150',
      spend: '49.50',
      reach: '3400',
      frequency: recentHalf ? '4.40' : '3.10',
      actions: [{ action_type: 'link_click', value: recentHalf ? '85' : '140' }],
      action_values: [],
    })
  }

  return rows
}

// ---------------------------------------------------------------------------
// Google Ads API — shapes reais de googleAds:search (GAQL)
// ---------------------------------------------------------------------------

export const MOCK_GOOGLE_CAMPAIGNS: GoogleAdsSearchRow[] = [
  {
    campaign: {
      resourceName: 'customers/1234567890/campaigns/20001',
      id: '20001',
      name: 'Search | Marca',
      status: 'ENABLED',
      advertisingChannelType: 'SEARCH',
      biddingStrategyType: 'TARGET_CPA',
      campaignBudget: 'customers/1234567890/campaignBudgets/30001',
    },
    campaignBudget: {
      resourceName: 'customers/1234567890/campaignBudgets/30001',
      amountMicros: '80000000', // R$80,00/dia em micros
    },
  },
  {
    campaign: {
      resourceName: 'customers/1234567890/campaigns/20002',
      id: '20002',
      name: 'PMax | Genérica',
      status: 'ENABLED',
      advertisingChannelType: 'PERFORMANCE_MAX',
      biddingStrategyType: 'MAXIMIZE_CONVERSION_VALUE',
      campaignBudget: 'customers/1234567890/campaignBudgets/30002',
    },
    campaignBudget: {
      resourceName: 'customers/1234567890/campaignBudgets/30002',
      amountMicros: '120000000',
    },
  },
]

/** Métricas diárias por campanha (segments.date) dos últimos 14 dias. */
export function buildMockGoogleMetrics(): GoogleAdsSearchRow[] {
  const rows: GoogleAdsSearchRow[] = []

  for (let day = 13; day >= 0; day--) {
    const date = isoDaysAgo(day)
    const recentHalf = day < 7

    // Search Marca — saudável e estável (CPA ~R$25, dentro do alvo)
    rows.push({
      campaign: { id: '20001', name: 'Search | Marca' },
      segments: { date },
      metrics: {
        impressions: '1800',
        clicks: '160',
        costMicros: '75000000', // R$75,00
        conversions: 3,
        conversionsValue: 450.0,
      },
    })

    // PMax — CPM disparando na metade recente (leilão mais caro, anomalia)
    rows.push({
      campaign: { id: '20002', name: 'PMax | Genérica' },
      segments: { date },
      metrics: {
        impressions: recentHalf ? '9000' : '14000',
        clicks: recentHalf ? '170' : '260',
        costMicros: recentHalf ? '118000000' : '115000000',
        conversions: recentHalf ? 2.5 : 4,
        conversionsValue: recentHalf ? 300.0 : 520.0,
      },
    })
  }

  return rows
}
