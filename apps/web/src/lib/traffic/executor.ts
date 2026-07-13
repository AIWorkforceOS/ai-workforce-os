// Executor de decisões do Traffic Specialist.
//
// Única porta de saída para mudanças em contas reais de anúncio. Regras
// duras (no código, não em prompt):
//   - Só executa decisões com payload executável (advisory_only nunca executa)
//   - Só toca entidades is_managed = true
//   - Orçamento re-validado contra os limites da estratégia antes do envio
//   - TODA execução (sucesso, falha ou dry-run) vira linha em ad_actions_log
//     com payload enviado, estado anterior e resposta da plataforma
//   - TRAFFIC_DRY_RUN=1 → registra tudo mas não chama a API (ensaio geral)

import type { SupabaseClient } from '@supabase/supabase-js'
import { logSystemEvent } from '@/lib/system-events'
import {
  getMetaConfig,
  setMetaDailyBudget,
  setMetaEntityStatus,
} from './meta-ads'
import {
  getGoogleAccessToken,
  getGoogleAdsConfig,
  setGoogleCampaignBudget,
  setGoogleCampaignStatus,
} from './google-ads'
import type {
  AdAccount,
  AdActionResult,
  AdEntity,
  RecommendedAction,
  TrafficDecision,
} from './types'

export type ExecutionOutcome = {
  result: AdActionResult
  error?: string
}

function isDryRun(): boolean {
  return process.env.TRAFFIC_DRY_RUN === '1'
}

/** Ação executável e válida? (advisory e payloads vazios nunca executam) */
export function isExecutable(action: RecommendedAction): boolean {
  if (action.advisory_only) return false
  return Boolean(action.set_status || action.set_daily_budget_cents)
}

function actionTypeOf(action: RecommendedAction): string {
  if (action.set_status === 'PAUSED') return 'pause'
  if (action.set_status === 'ACTIVE') return 'resume'
  if (action.set_daily_budget_cents) return 'set_budget'
  return 'unknown'
}

/**
 * Executa uma decisão aprovada (ou autônoma) na plataforma e grava a
 * auditoria. Atualiza o status da decisão para executed/failed.
 * `executedBy`: 'agent_autonomous' ou 'human_approved:<email>'.
 */
export async function executeDecision(
  supabase: SupabaseClient,
  params: {
    decision: TrafficDecision
    account: AdAccount
    entity: AdEntity | null
    executedBy: string
  },
): Promise<ExecutionOutcome> {
  const { decision, account, entity, executedBy } = params
  const action = decision.recommended_action

  async function logAction(
    result: AdActionResult,
    externalResponse: Record<string, unknown> | null,
    errorMessage?: string,
  ) {
    await supabase.from('ad_actions_log').insert({
      org_id: decision.org_id,
      unit_id: decision.unit_id,
      ad_account_id: account.id,
      entity_id: entity?.id ?? null,
      decision_id: decision.id,
      platform: account.platform,
      action_type: actionTypeOf(action),
      payload_sent: action as Record<string, unknown>,
      previous_state: entity
        ? { status: entity.status, daily_budget_cents: entity.daily_budget_cents }
        : {},
      result,
      external_response: externalResponse,
      error_message: errorMessage ?? null,
      executed_by: executedBy,
    })
  }

  async function finish(outcome: ExecutionOutcome): Promise<ExecutionOutcome> {
    await supabase
      .from('traffic_decisions')
      .update({
        status: outcome.result === 'failed' ? 'failed' : 'executed',
        executed_at: new Date().toISOString(),
      })
      .eq('id', decision.id)
    return outcome
  }

  // Guard-rails ------------------------------------------------------
  if (!isExecutable(action)) {
    return { result: 'failed', error: 'Decisão sem ação executável (advisory).' }
  }
  if (!entity) {
    await logAction('failed', null, 'Entidade da decisão não encontrada.')
    return finish({ result: 'failed', error: 'Entidade da decisão não encontrada.' })
  }
  if (!entity.is_managed) {
    await logAction('failed', null, 'Entidade marcada como não gerida (is_managed=false).')
    return finish({ result: 'failed', error: 'Entidade não é gerida pelo agente.' })
  }

  // Revalida limites de orçamento no momento da execução
  if (action.set_daily_budget_cents) {
    const { min_daily_budget_cents, max_daily_budget_cents } = account.strategy
    if (min_daily_budget_cents && action.set_daily_budget_cents < min_daily_budget_cents) {
      await logAction('failed', null, 'Orçamento abaixo do mínimo configurado.')
      return finish({ result: 'failed', error: 'Orçamento abaixo do mínimo configurado.' })
    }
    if (max_daily_budget_cents && action.set_daily_budget_cents > max_daily_budget_cents) {
      await logAction('failed', null, 'Orçamento acima do máximo configurado.')
      return finish({ result: 'failed', error: 'Orçamento acima do máximo configurado.' })
    }
  }

  if (isDryRun()) {
    await logAction('dry_run', { note: 'TRAFFIC_DRY_RUN=1 — nenhuma chamada real à plataforma.' })
    return finish({ result: 'dry_run' })
  }

  // Execução por plataforma -------------------------------------------
  try {
    let response: Record<string, unknown>

    if (account.platform === 'meta') {
      const config = getMetaConfig(account)
      if (!config) throw new Error('Credenciais Meta não configuradas para a conta.')

      if (action.set_status) {
        response = await setMetaEntityStatus(config, entity.external_id, action.set_status)
      } else {
        response = await setMetaDailyBudget(config, entity.external_id, action.set_daily_budget_cents!)
      }
    } else {
      const config = getGoogleAdsConfig(account)
      if (!config) throw new Error('Credenciais Google Ads não configuradas para a conta.')
      const accessToken = await getGoogleAccessToken(config)

      if (action.set_status) {
        response = await setGoogleCampaignStatus(config, accessToken, entity.external_id, action.set_status)
      } else {
        const budgetResourceName = (entity.raw as { campaign?: { campaignBudget?: string } })?.campaign
          ?.campaignBudget
        if (!budgetResourceName) {
          throw new Error('Resource name do orçamento não encontrado no raw da campanha Google.')
        }
        response = await setGoogleCampaignBudget(
          config,
          accessToken,
          budgetResourceName,
          action.set_daily_budget_cents!,
        )
      }
    }

    await logAction('success', response)

    // Reflete a mudança localmente para o dashboard não mostrar dado velho
    await supabase
      .from('ad_entities')
      .update({
        ...(action.set_status ? { status: action.set_status } : {}),
        ...(action.set_daily_budget_cents ? { daily_budget_cents: action.set_daily_budget_cents } : {}),
      })
      .eq('id', entity.id)

    return finish({ result: 'success' })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'erro desconhecido'
    await logAction('failed', null, message)
    await logSystemEvent(supabase, {
      level: 'error',
      source: account.platform === 'meta' ? 'meta_ads' : 'google_ads',
      eventType: 'traffic_action_failed',
      message: `Falha ao executar ação "${actionTypeOf(action)}" em "${entity.name}" (${account.name}): ${message}`,
      orgId: decision.org_id,
      unitId: decision.unit_id,
      metadata: { decision_id: decision.id, entity_external_id: entity.external_id },
    })
    return finish({ result: 'failed', error: message })
  }
}
