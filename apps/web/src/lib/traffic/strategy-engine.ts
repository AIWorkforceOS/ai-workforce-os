// Motor de estratégia do Traffic Specialist.
//
// Recebe entidades + métricas de um período e produz propostas de decisão
// com rationale legível (padrão do decision log do OS). Funções puras:
// nenhuma chamada de rede — quem coleta dados é o cron, quem executa é o
// executor. Isso mantém as regras 100% testáveis com dados mockados.
//
// Playbook implementado (o que um gestor de tráfego sênior faria):
//   1. Pausar o que queima dinheiro (CPA muito acima do alvo, com volume)
//   2. Escalar o que performa (ROAS acima do alvo → +orçamento, gradual)
//   3. Reduzir o que performa mal mas ainda não merece pausa
//   4. Realocação: resumo executivo quando há forte e fraco simultâneos
//   5. Fadiga de criativo (frequência alta + CTR caindo) → trocar criativo
//      e, em fadiga severa, sugerir novo público/lookalike
//   6. Anomalia de CPM (leilão encarecendo) → alerta
//   7. Gasto sem conversão → checar pixel/conversions API e landing page
//   8. Full-funnel: 100% do orçamento em fundo de funil → rebalancear
//   9. Estratégia de lance: volume de conversão suficiente em lance manual/
//      lowest cost → migrar para lance automático por CPA/valor
//
// Toda proposta carrega metrics_context com os números que a embasaram.

import {
  detectCpmSpike,
  detectCreativeFatigue,
  detectSpendWithoutConversions,
  formatCentsBRL,
  splitRecentVsPrevious,
} from './metrics'
import type { AggregatedMetrics } from './types'
import {
  DEFAULT_STRATEGY,
  type DecisionProposal,
  type FunnelStage,
  type PlatformEntity,
  type PlatformMetricsRow,
  type StrategyConfig,
} from './types'

export type EngineInput = {
  entities: (PlatformEntity & { is_managed?: boolean })[]
  /** métricas diárias do período (idealmente 14 dias) por entidade */
  metricsByEntity: Map<string, PlatformMetricsRow[]>
  strategy: StrategyConfig
}

/** Classifica o estágio de funil pelo objetivo da campanha (Meta e Google). */
export function classifyFunnelStage(objective: string | null): FunnelStage | null {
  if (!objective) return null
  const upper = objective.toUpperCase()

  if (['OUTCOME_AWARENESS', 'BRAND_AWARENESS', 'REACH', 'VIDEO', 'DISPLAY'].some((o) => upper.includes(o))) {
    return 'awareness'
  }
  if (
    ['OUTCOME_ENGAGEMENT', 'OUTCOME_TRAFFIC', 'ENGAGEMENT', 'TRAFFIC', 'DEMAND_GEN'].some((o) =>
      upper.includes(o),
    )
  ) {
    return 'consideration'
  }
  if (
    ['OUTCOME_SALES', 'OUTCOME_LEADS', 'OUTCOME_APP_PROMOTION', 'SEARCH', 'SHOPPING', 'PERFORMANCE_MAX', 'CONVERSIONS'].some(
      (o) => upper.includes(o),
    )
  ) {
    return 'conversion'
  }
  return null
}

function asPositiveNumber(value: unknown): number | null {
  const num = typeof value === 'string' ? Number(value) : value
  return typeof num === 'number' && Number.isFinite(num) && num > 0 ? num : null
}

/**
 * Deriva alvos de estratégia do business_profile coletado na entrevista
 * de contratação do Gestor de Tráfego (orçamento mensal → teto de
 * orçamento diário; CPA/ROAS alvo quando informados). O strategy explícito
 * da conta (ad_accounts.strategy) sempre tem precedência sobre isto.
 */
export function strategyFromBusinessProfile(
  profile: Record<string, unknown> | null | undefined,
): StrategyConfig {
  if (!profile) return {}
  const derived: StrategyConfig = {}

  const monthlyBudgetBrl = asPositiveNumber(profile.orcamento_mensal_brl)
  if (monthlyBudgetBrl) derived.max_daily_budget_cents = Math.round((monthlyBudgetBrl * 100) / 30)

  const targetCpaBrl = asPositiveNumber(profile.cpa_alvo_brl)
  if (targetCpaBrl) derived.target_cpa_cents = Math.round(targetCpaBrl * 100)

  const targetRoas = asPositiveNumber(profile.roas_alvo)
  if (targetRoas) derived.target_roas = targetRoas

  return derived
}

function clampBudget(cents: number, strategy: StrategyConfig): number {
  let value = cents
  if (strategy.max_daily_budget_cents) value = Math.min(value, strategy.max_daily_budget_cents)
  if (strategy.min_daily_budget_cents) value = Math.max(value, strategy.min_daily_budget_cents)
  return Math.max(100, Math.round(value)) // nunca abaixo de R$1,00
}

function contextFrom(recent: AggregatedMetrics, previous?: AggregatedMetrics): Record<string, unknown> {
  return {
    recent,
    ...(previous ? { previous } : {}),
  }
}

/**
 * Avalia uma conta e devolve as propostas de decisão. `entities` deve conter
 * o nível onde o orçamento vive (campanhas no Google; campanhas ou ad sets
 * na Meta, conforme o que a conta usa).
 */
export function evaluateAccount(input: EngineInput): DecisionProposal[] {
  const strategy = { ...DEFAULT_STRATEGY, ...input.strategy }
  const proposals: DecisionProposal[] = []

  const managed = input.entities.filter(
    (entity) => entity.is_managed !== false && entity.status === 'ACTIVE',
  )

  type Evaluated = {
    entity: (typeof managed)[number]
    recent: AggregatedMetrics
    previous: AggregatedMetrics
  }
  const evaluated: Evaluated[] = []

  for (const entity of managed) {
    const rows = input.metricsByEntity.get(entity.external_id) ?? []
    if (rows.length === 0) continue
    const { recent, previous } = splitRecentVsPrevious(rows)
    evaluated.push({ entity, recent, previous })
  }

  // -------------------------------------------------------------------
  // 1. Pausa por CPA estourado / 2. escala por ROAS / 3. redução gradual
  // -------------------------------------------------------------------
  const strongPerformers: Evaluated[] = []
  const weakPerformers: Evaluated[] = []

  for (const item of evaluated) {
    const { entity, recent, previous } = item
    const hasVolume = recent.conversions >= strategy.min_conversions_for_decision

    // Pausa: CPA acima do multiplicador do alvo, com volume estatístico
    if (
      hasVolume &&
      strategy.target_cpa_cents &&
      recent.cpa_cents !== null &&
      recent.cpa_cents > strategy.target_cpa_cents * strategy.cpa_pause_multiplier
    ) {
      proposals.push({
        entity_external_id: entity.external_id,
        decision_type: 'pause_entity',
        severity: 'critical',
        reasoning:
          `"${entity.name}" está com CPA de ${formatCentsBRL(recent.cpa_cents)} nos últimos ${recent.days} dias — ` +
          `${(recent.cpa_cents / strategy.target_cpa_cents).toFixed(1)}× o CPA alvo de ${formatCentsBRL(strategy.target_cpa_cents)}, ` +
          `com ${recent.conversions} conversões e ${formatCentsBRL(recent.spend_cents)} gastos. ` +
          `Recomendo pausar e redirecionar o orçamento para os conjuntos com melhor retorno.`,
        recommended_action: { set_status: 'PAUSED' },
        metrics_context: contextFrom(recent, previous),
      })
      weakPerformers.push(item)
      continue
    }

    // ROAS abaixo do aceitável (mas sem estourar o gatilho de pausa): reduzir
    if (
      hasVolume &&
      strategy.target_roas &&
      recent.roas !== null &&
      recent.roas < strategy.target_roas * 0.6 &&
      entity.daily_budget_cents
    ) {
      const newBudget = clampBudget(
        entity.daily_budget_cents * (1 - strategy.max_budget_change_pct / 100),
        strategy,
      )
      if (newBudget < entity.daily_budget_cents) {
        proposals.push({
          entity_external_id: entity.external_id,
          decision_type: 'decrease_budget',
          severity: 'warning',
          reasoning:
            `"${entity.name}" está com ROAS de ${recent.roas.toFixed(2)} — bem abaixo do alvo de ${strategy.target_roas.toFixed(2)}. ` +
            `Ainda converte (${recent.conversions} conversões), então em vez de pausar recomendo reduzir o orçamento diário ` +
            `de ${formatCentsBRL(entity.daily_budget_cents)} para ${formatCentsBRL(newBudget)} (−${strategy.max_budget_change_pct}%) ` +
            `enquanto testamos ajustes de criativo/público.`,
          recommended_action: { set_daily_budget_cents: newBudget },
          metrics_context: contextFrom(recent, previous),
        })
        weakPerformers.push(item)
        continue
      }
    }

    // Escala: ROAS confortavelmente acima do alvo (ou CPA bem abaixo do alvo)
    const roasStrong =
      strategy.target_roas && recent.roas !== null && recent.roas >= strategy.target_roas * 1.2
    const cpaStrong =
      strategy.target_cpa_cents &&
      recent.cpa_cents !== null &&
      recent.cpa_cents <= strategy.target_cpa_cents * 0.8

    if (hasVolume && (roasStrong || cpaStrong) && entity.daily_budget_cents) {
      const seasonal = strategy.seasonal_budget_multiplier
      const newBudget = clampBudget(
        entity.daily_budget_cents * (1 + strategy.max_budget_change_pct / 100) * seasonal,
        strategy,
      )
      if (newBudget > entity.daily_budget_cents) {
        const reasonMetric = roasStrong
          ? `ROAS de ${recent.roas!.toFixed(2)} (alvo: ${strategy.target_roas!.toFixed(2)})`
          : `CPA de ${formatCentsBRL(recent.cpa_cents)} (alvo: ${formatCentsBRL(strategy.target_cpa_cents ?? null)})`
        proposals.push({
          entity_external_id: entity.external_id,
          decision_type: 'increase_budget',
          severity: 'info',
          reasoning:
            `"${entity.name}" sustentou ${reasonMetric} nos últimos ${recent.days} dias com ${recent.conversions} conversões. ` +
            `Há espaço para escalar: recomendo subir o orçamento diário de ${formatCentsBRL(entity.daily_budget_cents)} ` +
            `para ${formatCentsBRL(newBudget)} (+${strategy.max_budget_change_pct}% — aumento gradual para não resetar a fase de aprendizado).` +
            (seasonal !== 1 ? ` Ajuste sazonal ativo (multiplicador ${seasonal}).` : ''),
          recommended_action: { set_daily_budget_cents: newBudget },
          metrics_context: contextFrom(recent, previous),
        })
        strongPerformers.push(item)
      }
    }
  }

  // -------------------------------------------------------------------
  // 4. Realocação (resumo executivo quando há forte + fraco simultâneos)
  // -------------------------------------------------------------------
  if (strongPerformers.length > 0 && weakPerformers.length > 0) {
    const best = strongPerformers[0]!
    const worst = weakPerformers[0]!
    proposals.push({
      entity_external_id: null,
      decision_type: 'reallocate_budget',
      severity: 'info',
      reasoning:
        `Realocação de verba recomendada: "${worst.entity.name}" está devolvendo ` +
        `${worst.recent.roas !== null ? `ROAS ${worst.recent.roas.toFixed(2)}` : `CPA ${formatCentsBRL(worst.recent.cpa_cents)}`} ` +
        `enquanto "${best.entity.name}" entrega ` +
        `${best.recent.roas !== null ? `ROAS ${best.recent.roas.toFixed(2)}` : `CPA ${formatCentsBRL(best.recent.cpa_cents)}`}. ` +
        `As ações individuais de pausa/redução e aumento já foram propostas — este é o resumo da movimentação de verba.`,
      recommended_action: { advisory_only: true },
      metrics_context: {
        strongest: { name: best.entity.name, ...best.recent },
        weakest: { name: worst.entity.name, ...worst.recent },
      },
    })
  }

  // -------------------------------------------------------------------
  // 5. Fadiga de criativo / 6. anomalia de CPM / 7. gasto sem conversão
  // -------------------------------------------------------------------
  for (const { entity, recent, previous } of evaluated) {
    const fatigue = detectCreativeFatigue({
      recent,
      previous,
      frequencyThreshold: strategy.frequency_fatigue_threshold,
      ctrDecayPct: strategy.ctr_decay_fatigue_pct,
    })
    if (fatigue) {
      proposals.push({
        entity_external_id: entity.external_id,
        decision_type: 'refresh_creative',
        severity: 'warning',
        reasoning:
          `Fadiga de criativo em "${entity.name}": frequência média de ${fatigue.frequency.toFixed(1)} ` +
          `(limiar: ${strategy.frequency_fatigue_threshold}) com queda de ${fatigue.ctrDropPct.toFixed(0)}% no CTR ` +
          `vs o período anterior. O público está saturado com os anúncios atuais — recomendo subir novos criativos ` +
          `(novo gancho/formato) antes que o CPM comece a subir.`,
        recommended_action: { advisory_only: true },
        metrics_context: contextFrom(recent, previous),
      })

      // Fadiga severa (frequência muito acima do limiar): além de criativo, público novo
      if (fatigue.frequency >= strategy.frequency_fatigue_threshold + 1) {
        proposals.push({
          entity_external_id: entity.external_id,
          decision_type: 'new_audience_suggestion',
          severity: 'warning',
          reasoning:
            `A frequência de ${fatigue.frequency.toFixed(1)} em "${entity.name}" indica público pequeno demais para o orçamento. ` +
            `Além de novos criativos, recomendo testar expansão de público: lookalike de compradores (1–3%), ` +
            `interesses adjacentes ou Advantage+ audience, mantendo o público atual como controle.`,
          recommended_action: { advisory_only: true },
          metrics_context: contextFrom(recent, previous),
        })
      }
    }

    const cpmSpike = detectCpmSpike({ recent, previous, spikePct: strategy.cpm_spike_alert_pct })
    if (cpmSpike) {
      proposals.push({
        entity_external_id: entity.external_id,
        decision_type: 'anomaly_alert',
        severity: 'warning',
        reasoning:
          `Anomalia em "${entity.name}": CPM subiu ${cpmSpike.cpmIncreasePct.toFixed(0)}% ` +
          `(agora em ${formatCentsBRL(cpmSpike.recentCpmCents)}) vs o período anterior. Possíveis causas: leilão mais ` +
          `disputado (sazonalidade/concorrência), queda de qualidade do anúncio ou público estreito demais. ` +
          `Monitorar 48h; se persistir, revisar segmentação e criativos.`,
        recommended_action: { advisory_only: true },
        metrics_context: contextFrom(recent, previous),
      })
    }

    const minSpendAlert =
      strategy.spend_without_conversion_alert_cents ??
      (strategy.target_cpa_cents ? strategy.target_cpa_cents * 3 : 30000)
    const noConversion = detectSpendWithoutConversions({ recent, minSpendCents: minSpendAlert })
    if (noConversion && classifyFunnelStage(entity.objective) === 'conversion') {
      proposals.push({
        entity_external_id: entity.external_id,
        decision_type: 'landing_page_suggestion',
        severity: 'critical',
        reasoning:
          `"${entity.name}" gastou ${formatCentsBRL(noConversion.spendCents)} com ${noConversion.clicks} cliques ` +
          `e ZERO conversões registradas no período. Antes de mexer na campanha, verificar nesta ordem: ` +
          `(1) pixel/Conversions API (Meta) ou tag de conversão/Enhanced Conversions (Google) disparando corretamente; ` +
          `(2) landing page — velocidade, coerência com o anúncio e clareza do CTA; (3) qualidade do tráfego (cliques inválidos). ` +
          `Se o rastreamento estiver ok, o problema é conversão de página, não de mídia.`,
        recommended_action: { advisory_only: true },
        metrics_context: contextFrom(recent, previous),
      })
    }

    // 9. Estratégia de lance: volume alto de conversões em lance "lowest cost"
    // ou manual → hora de migrar para lance automático orientado a alvo.
    const totalConversions = recent.conversions + previous.conversions
    const manualish =
      entity.bid_strategy &&
      ['LOWEST_COST_WITHOUT_CAP', 'MANUAL_CPC', 'TARGET_SPEND'].includes(entity.bid_strategy)
    if (manualish && totalConversions >= 30) {
      const target =
        entity.platform === 'meta'
          ? 'lance com meta de custo por resultado (cost cap)'
          : 'Target CPA / Maximize conversion value com tROAS'
      proposals.push({
        entity_external_id: entity.external_id,
        decision_type: 'change_bid_strategy',
        severity: 'info',
        reasoning:
          `"${entity.name}" acumulou ${Math.round(totalConversions)} conversões no período usando ${entity.bid_strategy}. ` +
          `Com esse volume, o leilão já tem sinal suficiente para lance automático orientado a alvo — ` +
          `recomendo testar ${target}, ancorado no CPA/ROAS alvo da conta. Mudar fora de pico e monitorar 5–7 dias.`,
        recommended_action: { advisory_only: true },
        metrics_context: contextFrom(recent, previous),
      })
    }
  }

  // -------------------------------------------------------------------
  // 8. Full-funnel: todo o orçamento concentrado em fundo de funil
  // -------------------------------------------------------------------
  const budgeted = input.entities.filter(
    (entity) => entity.status === 'ACTIVE' && (entity.daily_budget_cents ?? 0) > 0,
  )
  const totalBudget = budgeted.reduce((sum, entity) => sum + (entity.daily_budget_cents ?? 0), 0)
  if (totalBudget > 0) {
    const upperBudget = budgeted
      .filter((entity) => {
        const stage = classifyFunnelStage(entity.objective)
        return stage === 'awareness' || stage === 'consideration'
      })
      .reduce((sum, entity) => sum + (entity.daily_budget_cents ?? 0), 0)
    const upperPct = (upperBudget / totalBudget) * 100

    if (upperPct < strategy.min_upper_funnel_budget_pct && budgeted.length >= 2) {
      proposals.push({
        entity_external_id: null,
        decision_type: 'funnel_rebalance',
        severity: 'info',
        reasoning:
          `Apenas ${upperPct.toFixed(0)}% do orçamento diário (${formatCentsBRL(totalBudget)}) está em topo/meio de funil ` +
          `(mínimo recomendado: ${strategy.min_upper_funnel_budget_pct}%). Contas 100% focadas em conversão esgotam o público ` +
          `quente com o tempo e o CPA sobe. Recomendo destinar 10–20% da verba a campanhas de awareness/consideração ` +
          `(vídeo/alcance) para alimentar os públicos de remarketing.`,
        recommended_action: { advisory_only: true },
        metrics_context: {
          total_daily_budget_cents: totalBudget,
          upper_funnel_budget_cents: upperBudget,
          upper_funnel_pct: Math.round(upperPct * 100) / 100,
        },
      })
    }
  }

  return proposals
}
