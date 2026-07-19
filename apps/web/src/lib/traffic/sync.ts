// Pipeline de sincronização + otimização de uma conta de anúncio.
// Usado pelo cron (/api/cron/traffic) e pelo sync manual do painel.
//
// Passos: coleta entidades e métricas da plataforma (ou mock) →
// upsert em ad_entities / ad_metrics_snapshots → motor de estratégia →
// grava traffic_decisions (dedupe) → executa autônomas (se o modo permite)
// → gera relatório executivo diário.
//
// TRAFFIC_USE_MOCK=1 roda o pipeline inteiro com os dados mockados de
// mock-data.ts — é o modo de validação enquanto não há credenciais reais.

import type { SupabaseClient } from '@supabase/supabase-js'
import { logSystemEvent } from '@/lib/system-events'
import {
  getMetaConfig,
  getMetaInsights,
  listMetaAdSets,
  listMetaCampaigns,
  normalizeMetaAdSet,
  normalizeMetaCampaign,
  normalizeMetaInsights,
} from './meta-ads'
import {
  getGoogleAccessToken,
  getGoogleAdsConfig,
  getGoogleCampaignMetrics,
  listGoogleCampaigns,
  normalizeGoogleCampaign,
  normalizeGoogleMetrics,
} from './google-ads'
import {
  buildMockGoogleMetrics,
  buildMockMetaInsights,
  MOCK_GOOGLE_CAMPAIGNS,
  MOCK_META_ADSETS,
  MOCK_META_CAMPAIGNS,
} from './mock-data'
import { aggregate, computeDerived, splitRecentVsPrevious } from './metrics'
import { classifyFunnelStage, evaluateAccount, strategyFromBusinessProfile } from './strategy-engine'
import { executeDecision } from './executor'
import { buildHighlights, generateExecutiveSummary } from './reporting'
import { syncCampaignsToSmarterMarketing } from './smarter-campaigns'
import { fetchOrganizationBusinessProfile } from '@/lib/organizations'
import type { Unit } from '@/lib/types'
import type {
  AdAccount,
  AdEntity,
  DecisionProposal,
  PlatformEntity,
  PlatformMetricsRow,
  TrafficDecision,
} from './types'

const METRICS_WINDOW_DAYS = 14

export type SyncResult = {
  ok: boolean
  entities: number
  snapshots: number
  decisionsCreated: number
  decisionsExecuted: number
  usedMock: boolean
  error?: string
}

function useMock(): boolean {
  return process.env.TRAFFIC_USE_MOCK === '1'
}

async function collectFromPlatform(account: AdAccount): Promise<{
  entities: PlatformEntity[]
  metrics: PlatformMetricsRow[]
} | null> {
  if (useMock()) {
    if (account.platform === 'meta') {
      return {
        entities: [
          ...MOCK_META_CAMPAIGNS.map(normalizeMetaCampaign),
          ...MOCK_META_ADSETS.map(normalizeMetaAdSet),
        ],
        metrics: buildMockMetaInsights().map((row) => normalizeMetaInsights(row, 'campaign')),
      }
    }
    return {
      entities: MOCK_GOOGLE_CAMPAIGNS.map(normalizeGoogleCampaign).filter(
        (entity): entity is PlatformEntity => entity !== null,
      ),
      metrics: buildMockGoogleMetrics()
        .map(normalizeGoogleMetrics)
        .filter((row): row is PlatformMetricsRow => row !== null),
    }
  }

  if (account.platform === 'meta') {
    const config = getMetaConfig(account)
    if (!config) return null
    const [campaigns, adSets, campaignInsights, adSetInsights] = await Promise.all([
      listMetaCampaigns(config),
      listMetaAdSets(config),
      getMetaInsights(config, 'campaign', METRICS_WINDOW_DAYS),
      getMetaInsights(config, 'ad_set', METRICS_WINDOW_DAYS),
    ])
    return { entities: [...campaigns, ...adSets], metrics: [...campaignInsights, ...adSetInsights] }
  }

  const config = getGoogleAdsConfig(account)
  if (!config) return null
  const accessToken = await getGoogleAccessToken(config)
  const [campaigns, metrics] = await Promise.all([
    listGoogleCampaigns(config, accessToken),
    getGoogleCampaignMetrics(config, accessToken, METRICS_WINDOW_DAYS),
  ])
  return { entities: campaigns, metrics }
}

/**
 * Sincroniza e otimiza uma conta. Nunca lança: falhas viram
 * connection_status='error' + system_event e retornam ok=false.
 */
export async function syncAndOptimizeAccount(
  supabase: SupabaseClient,
  account: AdAccount,
): Promise<SyncResult> {
  const empty: SyncResult = {
    ok: false,
    entities: 0,
    snapshots: 0,
    decisionsCreated: 0,
    decisionsExecuted: 0,
    usedMock: useMock(),
  }

  try {
    const collected = await collectFromPlatform(account)

    if (!collected) {
      await supabase
        .from('ad_accounts')
        .update({
          connection_status: 'pending_credentials',
          connection_error: 'Credenciais da plataforma não configuradas.',
        })
        .eq('id', account.id)
      await logSystemEvent(supabase, {
        level: 'warning',
        source: account.platform === 'meta' ? 'meta_ads' : 'google_ads',
        eventType: 'traffic_sync_skipped',
        message: `Sync pulado na conta "${account.name}": credenciais não configuradas.`,
        orgId: account.org_id,
        unitId: account.unit_id,
      })
      return { ...empty, error: 'Credenciais não configuradas.' }
    }

    // 1. Upsert de entidades --------------------------------------------
    const entityRows = collected.entities.map((entity) => ({
      ad_account_id: account.id,
      unit_id: account.unit_id,
      platform: entity.platform,
      entity_level: entity.entity_level,
      external_id: entity.external_id,
      parent_external_id: entity.parent_external_id,
      name: entity.name,
      status: entity.status,
      objective: entity.objective,
      funnel_stage: classifyFunnelStage(entity.objective),
      daily_budget_cents: entity.daily_budget_cents,
      bid_strategy: entity.bid_strategy,
      raw: entity.raw,
    }))

    if (entityRows.length > 0) {
      const { error } = await supabase
        .from('ad_entities')
        .upsert(entityRows, { onConflict: 'ad_account_id,entity_level,external_id' })
      if (error) throw new Error(`Upsert de entidades falhou: ${error.message}`)
    }

    // Mapa external_id → linha persistida (id + is_managed)
    const { data: dbEntities } = await supabase
      .from('ad_entities')
      .select('*')
      .eq('ad_account_id', account.id)
    const entityByExternalId = new Map(
      ((dbEntities ?? []) as AdEntity[]).map((row) => [row.external_id, row]),
    )

    // 2. Upsert de snapshots com métricas derivadas ---------------------
    const snapshotRows = collected.metrics
      .map((row) => {
        const entity = entityByExternalId.get(row.entity_external_id)
        if (!entity) return null
        return {
          entity_id: entity.id,
          ad_account_id: account.id,
          unit_id: account.unit_id,
          snapshot_date: row.date,
          impressions: row.impressions,
          clicks: row.clicks,
          spend_cents: row.spend_cents,
          conversions: row.conversions,
          conversion_value_cents: row.conversion_value_cents,
          reach: row.reach,
          frequency: row.frequency,
          ...computeDerived(row),
          extra: row.extra ?? {},
        }
      })
      .filter((row): row is NonNullable<typeof row> => row !== null)

    if (snapshotRows.length > 0) {
      const { error } = await supabase
        .from('ad_metrics_snapshots')
        .upsert(snapshotRows, { onConflict: 'entity_id,snapshot_date' })
      if (error) throw new Error(`Upsert de snapshots falhou: ${error.message}`)
    }

    // 2b. Espelho de campanhas na Smarter (opcional, por unidade) --------
    const { data: unitRow } = await supabase
      .from('units')
      .select('*')
      .eq('id', account.unit_id)
      .maybeSingle()
    if (unitRow && (unitRow as Unit).smarter_marketing_partner_token) {
      const campaignEntities = ((dbEntities ?? []) as AdEntity[]).filter(
        (row) => row.entity_level === 'campaign',
      )
      await syncCampaignsToSmarterMarketing(supabase, unitRow as Unit, account, campaignEntities)
    }

    // 3. Motor de estratégia --------------------------------------------
    const metricsByEntity = new Map<string, PlatformMetricsRow[]>()
    for (const row of collected.metrics) {
      const list = metricsByEntity.get(row.entity_external_id) ?? []
      list.push(row)
      metricsByEntity.set(row.entity_external_id, list)
    }

    const engineEntities = collected.entities.map((entity) => ({
      ...entity,
      is_managed: entityByExternalId.get(entity.external_id)?.is_managed ?? true,
    }))

    // Contexto de negócio aprendido na entrevista de contratação do
    // Gestor de Tráfego: vira defaults de estratégia (orçamento/CPA/ROAS
    // alvo); o strategy explícito da conta continua tendo precedência.
    const { data: trafficConfig } = await supabase
      .from('agent_configs')
      .select('*')
      .eq('unit_id', account.unit_id)
      .eq('agent_type', 'traffic_specialist')
      .maybeSingle()
    const businessProfile = (trafficConfig as { business_profile?: Record<string, unknown> } | null)
      ?.business_profile

    // Ficha compartilhada da organização (migration 025) soma-se à ficha
    // específica do Gestor de Tráfego antes de derivar os alvos de
    // estratégia — campos específicos do agente têm precedência em caso
    // de conflito. Quando a ficha compartilhada está vazia (hoje, sempre),
    // o resultado é idêntico a usar só businessProfile.
    const organizationProfile = await fetchOrganizationBusinessProfile(supabase, (unitRow as Unit | null)?.org_id)
    const mergedBusinessProfile = { ...(organizationProfile ?? {}), ...(businessProfile ?? {}) }

    const proposals = evaluateAccount({
      entities: engineEntities,
      metricsByEntity,
      strategy: { ...strategyFromBusinessProfile(mergedBusinessProfile), ...(account.strategy ?? {}) },
    })

    // 4. Persistir decisões (dedupe: não repetir sugestão aberta igual) --
    const { data: openDecisions } = await supabase
      .from('traffic_decisions')
      .select('decision_type, entity_id')
      .eq('ad_account_id', account.id)
      .in('status', ['suggested', 'approved'])

    const openKeys = new Set(
      ((openDecisions ?? []) as { decision_type: string; entity_id: string | null }[]).map(
        (row) => `${row.decision_type}:${row.entity_id ?? 'account'}`,
      ),
    )

    const toInsert: (DecisionProposal & { entityDbId: string | null })[] = []
    for (const proposal of proposals) {
      const entityDbId = proposal.entity_external_id
        ? (entityByExternalId.get(proposal.entity_external_id)?.id ?? null)
        : null
      const key = `${proposal.decision_type}:${entityDbId ?? 'account'}`
      if (openKeys.has(key)) continue
      openKeys.add(key)
      toInsert.push({ ...proposal, entityDbId })
    }

    let decisionsCreated = 0
    const createdDecisions: TrafficDecision[] = []

    if (toInsert.length > 0) {
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
      const { data: inserted, error } = await supabase
        .from('traffic_decisions')
        .insert(
          toInsert.map((proposal) => ({
            org_id: account.org_id,
            unit_id: account.unit_id,
            ad_account_id: account.id,
            entity_id: proposal.entityDbId,
            decision_type: proposal.decision_type,
            severity: proposal.severity,
            reasoning: proposal.reasoning,
            recommended_action: proposal.recommended_action,
            metrics_context: proposal.metrics_context,
            mode: account.optimization_mode,
            status: 'suggested',
            expires_at: expiresAt,
          })),
        )
        .select('*')
      if (error) throw new Error(`Insert de decisões falhou: ${error.message}`)
      createdDecisions.push(...((inserted ?? []) as TrafficDecision[]))
      decisionsCreated = createdDecisions.length
    }

    // 5. Modo autônomo: executa direto o que tem payload executável ------
    let decisionsExecuted = 0
    if (account.optimization_mode === 'autonomous') {
      for (const decision of createdDecisions) {
        const action = decision.recommended_action
        if (action.advisory_only || (!action.set_status && !action.set_daily_budget_cents)) continue

        const entity = decision.entity_id
          ? (((dbEntities ?? []) as AdEntity[]).find((row) => row.id === decision.entity_id) ?? null)
          : null
        const outcome = await executeDecision(supabase, {
          decision,
          account,
          entity,
          executedBy: 'agent_autonomous',
        })
        if (outcome.result !== 'failed') decisionsExecuted += 1
      }
    }

    // 6. Relatório executivo diário --------------------------------------
    const allRows = collected.metrics
    if (allRows.length > 0) {
      const { recent, previous } = splitRecentVsPrevious(allRows)
      const totals = aggregate(allRows)
      const periodEnd = new Date().toISOString().slice(0, 10)
      const periodStart = new Date(Date.now() - METRICS_WINDOW_DAYS * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10)

      const reportInput = {
        accountName: account.name,
        platformLabel: account.platform === 'meta' ? 'Meta Ads' : 'Google Ads',
        periodLabel: `últimos ${METRICS_WINDOW_DAYS} dias`,
        totals,
        previousTotals: previous.days > 0 ? previous : null,
        decisions: proposals,
      }
      const summary = await generateExecutiveSummary(reportInput)

      await supabase.from('traffic_reports').upsert(
        {
          org_id: account.org_id,
          unit_id: account.unit_id,
          ad_account_id: account.id,
          report_type: 'daily',
          period_start: periodStart,
          period_end: periodEnd,
          summary,
          highlights: {
            ...buildHighlights(reportInput),
            recent_roas: recent.roas,
          },
        },
        { onConflict: 'ad_account_id,report_type,period_start,period_end' },
      )
    }

    // 7. Conta saudável ----------------------------------------------------
    await supabase
      .from('ad_accounts')
      .update({
        connection_status: 'connected',
        connection_error: null,
        last_synced_at: new Date().toISOString(),
      })
      .eq('id', account.id)

    return {
      ok: true,
      entities: entityRows.length,
      snapshots: snapshotRows.length,
      decisionsCreated,
      decisionsExecuted,
      usedMock: useMock(),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'erro desconhecido'
    await supabase
      .from('ad_accounts')
      .update({ connection_status: 'error', connection_error: message })
      .eq('id', account.id)
    await logSystemEvent(supabase, {
      level: 'error',
      source: account.platform === 'meta' ? 'meta_ads' : 'google_ads',
      eventType: 'traffic_sync_failed',
      message: `Sync da conta "${account.name}" falhou: ${message}`,
      orgId: account.org_id,
      unitId: account.unit_id,
    })
    return { ...empty, error: message }
  }
}
