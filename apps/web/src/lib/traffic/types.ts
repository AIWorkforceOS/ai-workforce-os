// Tipos de domínio do Traffic Specialist (Meta Ads + Google Ads).
// Espelham as tabelas da migration 20260713000007_traffic_specialist.sql.

export type AdPlatform = 'meta' | 'google'

export type AdAccountConnectionStatus =
  | 'pending_credentials'
  | 'connected'
  | 'error'
  | 'disconnected'

export type OptimizationMode = 'suggestion' | 'autonomous'

/**
 * Alvos e limites do motor de estratégia, por conta de anúncio
 * (ad_accounts.strategy). Tudo opcional — o motor aplica DEFAULT_STRATEGY
 * para o que não estiver definido.
 */
export type StrategyConfig = {
  /** CPA alvo em centavos; acima de cpa_pause_multiplier × alvo → sugerir pausa */
  target_cpa_cents?: number
  /** ROAS alvo (ex: 3 = R$3 de retorno por R$1 gasto) */
  target_roas?: number
  /** orçamento diário mínimo por entidade (nunca reduzir abaixo) */
  min_daily_budget_cents?: number
  /** orçamento diário máximo por entidade (nunca aumentar acima) */
  max_daily_budget_cents?: number
  /** variação máxima de orçamento por decisão, em % (padrão 20) */
  max_budget_change_pct?: number
  /** multiplicador do CPA alvo que dispara sugestão de pausa (padrão 1.5) */
  cpa_pause_multiplier?: number
  /** conversões mínimas no período para decisões baseadas em CPA/ROAS (padrão 5) */
  min_conversions_for_decision?: number
  /** frequência (Meta) acima da qual investigamos fadiga de criativo (padrão 3.5) */
  frequency_fatigue_threshold?: number
  /** queda de CTR (%) vs período anterior que confirma fadiga (padrão 25) */
  ctr_decay_fatigue_pct?: number
  /** alta de CPM (%) vs período anterior que dispara alerta de anomalia (padrão 40) */
  cpm_spike_alert_pct?: number
  /** gasto mínimo em centavos sem nenhuma conversão que dispara alerta (padrão 3× CPA alvo) */
  spend_without_conversion_alert_cents?: number
  /** multiplicador sazonal de orçamento (ex: 1.3 em datas fortes); aplicado às sugestões de aumento */
  seasonal_budget_multiplier?: number
  /** % mínima do orçamento total em topo/meio de funil antes de sugerir rebalanceamento (padrão 10) */
  min_upper_funnel_budget_pct?: number
}

export const DEFAULT_STRATEGY: Required<
  Pick<
    StrategyConfig,
    | 'max_budget_change_pct'
    | 'cpa_pause_multiplier'
    | 'min_conversions_for_decision'
    | 'frequency_fatigue_threshold'
    | 'ctr_decay_fatigue_pct'
    | 'cpm_spike_alert_pct'
    | 'seasonal_budget_multiplier'
    | 'min_upper_funnel_budget_pct'
  >
> = {
  max_budget_change_pct: 20,
  cpa_pause_multiplier: 1.5,
  min_conversions_for_decision: 5,
  frequency_fatigue_threshold: 3.5,
  ctr_decay_fatigue_pct: 25,
  cpm_spike_alert_pct: 40,
  seasonal_budget_multiplier: 1,
  min_upper_funnel_budget_pct: 10,
}

export type AdAccount = {
  id: string
  org_id: string
  unit_id: string
  platform: AdPlatform
  external_account_id: string
  name: string
  currency: string
  timezone: string
  access_token: string | null
  refresh_token: string | null
  /** Overrides opcionais por conta do app OAuth do Google Ads (self-service avançado). Null = usa envs globais da MCC Alizo. */
  google_developer_token: string | null
  google_client_id: string | null
  google_client_secret: string | null
  connection_status: AdAccountConnectionStatus
  connection_error: string | null
  optimization_mode: OptimizationMode
  strategy: StrategyConfig
  last_synced_at: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export type AdEntityLevel = 'campaign' | 'ad_set' | 'ad'

/** Status normalizado entre plataformas (Meta usa ACTIVE/PAUSED; Google ENABLED/PAUSED). */
export type AdEntityStatus = 'ACTIVE' | 'PAUSED' | 'ARCHIVED' | 'REMOVED' | 'UNKNOWN'

export type FunnelStage = 'awareness' | 'consideration' | 'conversion'

export type AdEntity = {
  id: string
  ad_account_id: string
  unit_id: string
  platform: AdPlatform
  entity_level: AdEntityLevel
  external_id: string
  parent_external_id: string | null
  name: string
  status: AdEntityStatus
  objective: string | null
  funnel_stage: FunnelStage | null
  daily_budget_cents: number | null
  bid_strategy: string | null
  is_managed: boolean
  raw: Record<string, unknown>
  created_at: string
  updated_at: string
}

export type MetricsSnapshot = {
  id: string
  entity_id: string
  ad_account_id: string
  unit_id: string
  snapshot_date: string
  impressions: number
  clicks: number
  spend_cents: number
  conversions: number
  conversion_value_cents: number
  reach: number | null
  frequency: number | null
  ctr: number | null
  cpc_cents: number | null
  cpm_cents: number | null
  cpa_cents: number | null
  roas: number | null
  extra: Record<string, unknown>
  created_at: string
}

/** Métricas agregadas de um período, com derivadas calculadas. */
export type AggregatedMetrics = {
  impressions: number
  clicks: number
  spend_cents: number
  conversions: number
  conversion_value_cents: number
  frequency: number | null
  ctr: number | null
  cpc_cents: number | null
  cpm_cents: number | null
  cpa_cents: number | null
  roas: number | null
  days: number
}

export type TrafficDecisionType =
  | 'pause_entity'
  | 'resume_entity'
  | 'increase_budget'
  | 'decrease_budget'
  | 'reallocate_budget'
  | 'change_bid_strategy'
  | 'refresh_creative'
  | 'new_audience_suggestion'
  | 'landing_page_suggestion'
  | 'anomaly_alert'
  | 'funnel_rebalance'
  | 'seasonal_adjustment'
  | 'policy_risk_alert'

export type TrafficDecisionSeverity = 'info' | 'warning' | 'critical'

export type TrafficDecisionStatus =
  | 'suggested'
  | 'approved'
  | 'rejected'
  | 'executed'
  | 'failed'
  | 'expired'

/** Ação executável associada a uma decisão (payload de recommended_action). */
export type RecommendedAction = {
  /** novo status desejado na plataforma */
  set_status?: 'PAUSED' | 'ACTIVE'
  /** novo orçamento diário em centavos */
  set_daily_budget_cents?: number
  /** nova estratégia de lance (nome normalizado da plataforma) */
  set_bid_strategy?: string
  /** decisões informativas (alertas, sugestões de criativo/landing) não têm payload executável */
  advisory_only?: boolean
}

export type TrafficDecision = {
  id: string
  org_id: string
  unit_id: string
  ad_account_id: string
  entity_id: string | null
  decision_type: TrafficDecisionType
  severity: TrafficDecisionSeverity
  reasoning: string
  recommended_action: RecommendedAction
  metrics_context: Record<string, unknown>
  mode: OptimizationMode
  status: TrafficDecisionStatus
  decided_by: string | null
  executed_at: string | null
  expires_at: string | null
  created_at: string
  updated_at: string
}

/** Proposta de decisão gerada pelo motor (antes de persistir). */
export type DecisionProposal = {
  entity_external_id: string | null
  entity_id?: string | null
  decision_type: TrafficDecisionType
  severity: TrafficDecisionSeverity
  reasoning: string
  recommended_action: RecommendedAction
  metrics_context: Record<string, unknown>
}

export type AdActionResult = 'success' | 'failed' | 'dry_run'

export type AdActionLog = {
  id: string
  org_id: string
  unit_id: string
  ad_account_id: string
  entity_id: string | null
  decision_id: string | null
  platform: AdPlatform
  action_type: string
  payload_sent: Record<string, unknown>
  previous_state: Record<string, unknown>
  result: AdActionResult
  external_response: Record<string, unknown> | null
  error_message: string | null
  executed_by: string
  created_at: string
}

export type TrafficReport = {
  id: string
  org_id: string
  unit_id: string
  ad_account_id: string
  report_type: 'daily' | 'weekly'
  period_start: string
  period_end: string
  summary: string
  highlights: Record<string, unknown>
  created_at: string
}

/**
 * Forma normalizada de uma entidade vinda da plataforma (Meta ou Google),
 * antes do upsert em ad_entities.
 */
export type PlatformEntity = {
  platform: AdPlatform
  entity_level: AdEntityLevel
  external_id: string
  parent_external_id: string | null
  name: string
  status: AdEntityStatus
  objective: string | null
  daily_budget_cents: number | null
  bid_strategy: string | null
  raw: Record<string, unknown>
}

/**
 * Forma normalizada de uma linha de métricas vinda da plataforma,
 * antes do upsert em ad_metrics_snapshots.
 */
export type PlatformMetricsRow = {
  entity_external_id: string
  entity_level: AdEntityLevel
  date: string // YYYY-MM-DD
  impressions: number
  clicks: number
  spend_cents: number
  conversions: number
  conversion_value_cents: number
  reach: number | null
  frequency: number | null
  extra?: Record<string, unknown>
}
