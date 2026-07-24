// Único ponto de entrada para CRIAR campanhas novas em contas reais de
// anúncio (Meta Ads + Google Ads). Espelha as regras duras de executor.ts
// (que só MODIFICA entidades já existentes):
//
//   - Toda campanha/conjunto/anúncio nasce PAUSED na plataforma — revisão
//     humana liga (nenhuma campanha vai ao ar sozinha)
//   - Sem credenciais configuradas (getMetaConfig/getGoogleAdsConfig
//     retornam null) → cai no modo mock: gera ids fake, nunca chama a
//     API, nunca quebra (mesma degradação graciosa do resto do OS)
//   - TRAFFIC_DRY_RUN=1 → mesmo efeito do mock (ids fake), mas mesmo com
//     credenciais reais configuradas — ensaio geral antes de ir a sério
//   - TODA tentativa (success/partial/failed/dry_run/mock) vira uma linha
//     em ad_actions_log com o payload enviado e a resposta/erro por etapa
//   - Sucesso (mesmo parcial) upserta as entidades criadas em ad_entities
//     com is_managed=true, para o dashboard e o motor de estratégia
//     enxergarem a campanha nova imediatamente
//
// 'partial' existe porque a Meta e o Google exigem várias chamadas em
// sequência (campanha → conjunto → criativo → anúncio na Meta; orçamento →
// campanha → grupo → anúncio no Google) — uma falha no meio do caminho
// deixa recursos reais criados na conta do cliente. Nunca escondemos isso:
// o resultado 'partial' e o campo `error` explicam exatamente onde parou.

import type { SupabaseClient } from '@supabase/supabase-js'
import { logSystemEvent } from '@/lib/system-events'
import {
  createMetaAd,
  createMetaAdCreative,
  createMetaAdSet,
  createMetaCampaign,
  getMetaConfig,
  metaOptimizationGoalFor,
} from './meta-ads'
import {
  createGoogleAdGroup,
  createGoogleCampaign,
  createGoogleCampaignBudget,
  createGoogleResponsiveSearchAd,
  getGoogleAccessToken,
  getGoogleAdsConfig,
} from './google-ads'
import { classifyFunnelStage } from './strategy-engine'
import type {
  AdAccount,
  AdActionResult,
  CampaignCreative,
  CampaignLaunchOutcome,
  CampaignLaunchStep,
  CampaignLaunchStepResult,
  NewCampaignSpec,
} from './types'

function isDryRun(): boolean {
  return process.env.TRAFFIC_DRY_RUN === '1'
}

function mockExternalId(prefix: string): string {
  return `mock_${prefix}_${Date.now()}_${Math.round(Math.random() * 1_000_000)}`
}

/** "customers/123/campaigns/456" → "456" (external_id normalizado como no resto do sync). */
function googleIdFromResourceName(resourceName: string): string {
  return resourceName.split('/').pop() ?? resourceName
}

const GOOGLE_HEADLINE_MAX = 30
const GOOGLE_DESCRIPTION_MAX = 90

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`
}

/**
 * RSA exige no mínimo 3 headlines e 2 descriptions; o NewCampaignSpec só
 * carrega um headline/body (contrato simples pedido nesta rodada).
 * Derivamos variações truncadas para bater o mínimo exigido pela API —
 * não é o ideal (headlines repetidas reduzem a eficácia do algoritmo de
 * combinação do RSA), mas mantém a campanha criável sem exigir múltiplos
 * criativos do chamador. Evolução futura: aceitar headlines[]/descriptions[].
 */
function buildGoogleHeadlines(creative: CampaignCreative): string[] {
  return [
    truncate(creative.headline, GOOGLE_HEADLINE_MAX),
    truncate(creative.body, GOOGLE_HEADLINE_MAX),
    truncate(`${creative.headline} - Saiba mais`, GOOGLE_HEADLINE_MAX),
  ]
}

function buildGoogleDescriptions(creative: CampaignCreative): string[] {
  return [
    truncate(creative.body, GOOGLE_DESCRIPTION_MAX),
    truncate(`${creative.headline}. ${creative.body}`, GOOGLE_DESCRIPTION_MAX),
  ]
}

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

async function launchMetaCampaign(account: AdAccount, spec: NewCampaignSpec): Promise<CampaignLaunchOutcome> {
  const config = getMetaConfig(account)

  if (!config || isDryRun()) {
    const mode: AdActionResult = !config ? 'mock' : 'dry_run'
    const campaignId = mockExternalId('campaign')
    const adSetId = mockExternalId('adset')
    const adId = mockExternalId('ad')
    return {
      result: mode,
      campaignExternalId: campaignId,
      adSetExternalId: adSetId,
      adExternalId: adId,
      steps: [
        { step: 'campaign', externalId: campaignId },
        { step: 'ad_set', externalId: adSetId },
        { step: 'creative', externalId: mockExternalId('creative') },
        { step: 'ad', externalId: adId },
      ],
    }
  }

  const steps: CampaignLaunchStepResult[] = []
  let currentStep: CampaignLaunchStep = 'campaign'
  let campaignId: string | null = null
  let adSetId: string | null = null
  let adId: string | null = null

  try {
    const campaign = await createMetaCampaign(config, {
      name: spec.name,
      objective: spec.objective,
      status: 'PAUSED',
    })
    campaignId = campaign.id
    steps.push({ step: 'campaign', externalId: campaign.id })

    currentStep = 'ad_set'
    const optimizationGoal = metaOptimizationGoalFor(spec.objective, Boolean(spec.metaPixelId))
    const adSet = await createMetaAdSet(config, {
      name: `${spec.name} — Conjunto 1`,
      campaignId: campaign.id,
      dailyBudgetCents: spec.dailyBudgetCents,
      optimizationGoal,
      status: 'PAUSED',
      targeting: {
        countries: spec.targeting.countries,
        ageMin: spec.targeting.ageMin,
        ageMax: spec.targeting.ageMax,
        interestIds: spec.targeting.interests,
      },
      promotedObjectPixelId: spec.metaPixelId,
    })
    adSetId = adSet.id
    steps.push({ step: 'ad_set', externalId: adSet.id })

    if (!spec.metaPageId) {
      return {
        result: 'partial',
        campaignExternalId: campaignId,
        adSetExternalId: adSetId,
        adExternalId: null,
        steps,
        error:
          'metaPageId ausente — campanha e conjunto criados, mas o anúncio não: uma Página do Facebook é obrigatória para o criativo.',
      }
    }

    currentStep = 'creative'
    const creative = await createMetaAdCreative(config, {
      name: `${spec.name} — Criativo 1`,
      pageId: spec.metaPageId,
      message: spec.creative.body,
      linkUrl: spec.creative.linkUrl,
      headline: spec.creative.headline,
      callToActionType: spec.creative.callToAction,
    })
    steps.push({ step: 'creative', externalId: creative.id })

    currentStep = 'ad'
    const ad = await createMetaAd(config, {
      name: `${spec.name} — Anúncio 1`,
      adSetId: adSet.id,
      creativeId: creative.id,
      status: 'PAUSED',
    })
    adId = ad.id
    steps.push({ step: 'ad', externalId: ad.id })

    return { result: 'success', campaignExternalId: campaignId, adSetExternalId: adSetId, adExternalId: adId, steps }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'erro desconhecido'
    steps.push({ step: currentStep, externalId: null, error: message })
    return {
      result: steps.some((s) => s.externalId) ? 'partial' : 'failed',
      campaignExternalId: campaignId,
      adSetExternalId: adSetId,
      adExternalId: adId,
      steps,
      error: message,
    }
  }
}

// ---------------------------------------------------------------------------
// Google
// ---------------------------------------------------------------------------

async function launchGoogleCampaign(account: AdAccount, spec: NewCampaignSpec): Promise<CampaignLaunchOutcome> {
  const config = getGoogleAdsConfig(account)

  if (!config || isDryRun()) {
    const mode: AdActionResult = !config ? 'mock' : 'dry_run'
    const campaignId = mockExternalId('campaign')
    const adGroupId = mockExternalId('adgroup')
    const adId = mockExternalId('ad')
    return {
      result: mode,
      campaignExternalId: campaignId,
      adSetExternalId: adGroupId,
      adExternalId: adId,
      steps: [
        { step: 'budget', externalId: mockExternalId('budget') },
        { step: 'campaign', externalId: campaignId },
        { step: 'ad_set', externalId: adGroupId },
        { step: 'ad', externalId: adId },
      ],
    }
  }

  const steps: CampaignLaunchStepResult[] = []
  let currentStep: CampaignLaunchStep = 'budget'
  let campaignId: string | null = null
  let adGroupId: string | null = null
  let adId: string | null = null

  try {
    const accessToken = await getGoogleAccessToken(config)

    const budget = await createGoogleCampaignBudget(config, accessToken, spec.name, spec.dailyBudgetCents)
    steps.push({ step: 'budget', externalId: googleIdFromResourceName(budget.resourceName) })

    currentStep = 'campaign'
    const campaign = await createGoogleCampaign(
      config,
      accessToken,
      { name: spec.name, channelType: spec.objective, status: 'PAUSED' },
      budget.resourceName,
    )
    campaignId = googleIdFromResourceName(campaign.resourceName)
    steps.push({ step: 'campaign', externalId: campaignId })

    if (spec.objective !== 'SEARCH') {
      return {
        result: 'partial',
        campaignExternalId: campaignId,
        adSetExternalId: null,
        adExternalId: null,
        steps,
        error:
          `Canal "${spec.objective}" tem campanha+orçamento criados, mas não grupo de anúncios/anúncio: ` +
          'só SEARCH tem o fluxo completo nesta rodada (Display/PMax/Video exigem asset groups com imagem/vídeo — não implementado).',
      }
    }

    currentStep = 'ad_set'
    const adGroup = await createGoogleAdGroup(
      config,
      accessToken,
      { name: `${spec.name} — Grupo 1`, status: 'PAUSED' },
      campaign.resourceName,
    )
    adGroupId = googleIdFromResourceName(adGroup.resourceName)
    steps.push({ step: 'ad_set', externalId: adGroupId })

    currentStep = 'ad'
    const ad = await createGoogleResponsiveSearchAd(
      config,
      accessToken,
      {
        headlines: buildGoogleHeadlines(spec.creative),
        descriptions: buildGoogleDescriptions(spec.creative),
        finalUrls: [spec.creative.linkUrl],
        status: 'PAUSED',
      },
      adGroup.resourceName,
    )
    adId = googleIdFromResourceName(ad.resourceName)
    steps.push({ step: 'ad', externalId: adId })

    return {
      result: 'success',
      campaignExternalId: campaignId,
      adSetExternalId: adGroupId,
      adExternalId: adId,
      steps,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'erro desconhecido'
    steps.push({ step: currentStep, externalId: null, error: message })
    return {
      result: steps.some((s) => s.externalId) ? 'partial' : 'failed',
      campaignExternalId: campaignId,
      adSetExternalId: adGroupId,
      adExternalId: adId,
      steps,
      error: message,
    }
  }
}

// ---------------------------------------------------------------------------
// Orquestração + persistência (chamada pela API route)
// ---------------------------------------------------------------------------

/**
 * Cria uma campanha do zero na plataforma da conta, persiste as entidades
 * criadas em ad_entities e registra a tentativa em ad_actions_log.
 * `executedBy`: 'agent_autonomous' ou 'human_approved:<email>' (mesmo
 * padrão de executor.ts).
 */
export async function launchCampaign(
  supabase: SupabaseClient,
  params: { account: AdAccount; spec: NewCampaignSpec; executedBy: string },
): Promise<CampaignLaunchOutcome> {
  const { account, spec, executedBy } = params

  const outcome =
    account.platform === 'meta' ? await launchMetaCampaign(account, spec) : await launchGoogleCampaign(account, spec)

  const entityRows: Record<string, unknown>[] = []
  if (outcome.campaignExternalId) {
    entityRows.push({
      ad_account_id: account.id,
      unit_id: account.unit_id,
      platform: account.platform,
      entity_level: 'campaign',
      external_id: outcome.campaignExternalId,
      parent_external_id: null,
      name: spec.name,
      status: 'PAUSED',
      objective: spec.objective,
      funnel_stage: classifyFunnelStage(spec.objective),
      daily_budget_cents: spec.dailyBudgetCents,
      bid_strategy: null,
      is_managed: true,
      raw: {},
    })
  }
  if (outcome.adSetExternalId) {
    entityRows.push({
      ad_account_id: account.id,
      unit_id: account.unit_id,
      platform: account.platform,
      entity_level: 'ad_set',
      external_id: outcome.adSetExternalId,
      parent_external_id: outcome.campaignExternalId,
      name: `${spec.name} — Conjunto 1`,
      status: 'PAUSED',
      objective: spec.objective,
      funnel_stage: classifyFunnelStage(spec.objective),
      daily_budget_cents: account.platform === 'meta' ? spec.dailyBudgetCents : null,
      bid_strategy: null,
      is_managed: true,
      raw: {},
    })
  }
  if (outcome.adExternalId) {
    entityRows.push({
      ad_account_id: account.id,
      unit_id: account.unit_id,
      platform: account.platform,
      entity_level: 'ad',
      external_id: outcome.adExternalId,
      parent_external_id: outcome.adSetExternalId,
      name: `${spec.name} — Anúncio 1`,
      status: 'PAUSED',
      objective: null,
      funnel_stage: null,
      daily_budget_cents: null,
      bid_strategy: null,
      is_managed: true,
      raw: {},
    })
  }

  let campaignEntityId: string | null = null
  if (entityRows.length > 0) {
    const { data: upserted, error } = await supabase
      .from('ad_entities')
      .upsert(entityRows, { onConflict: 'ad_account_id,entity_level,external_id' })
      .select('id, entity_level, external_id')
    if (!error) {
      const rows = (upserted ?? []) as { id: string; entity_level: string; external_id: string }[]
      campaignEntityId =
        rows.find((row) => row.entity_level === 'campaign' && row.external_id === outcome.campaignExternalId)?.id ??
        null
    }
  }

  await supabase.from('ad_actions_log').insert({
    org_id: account.org_id,
    unit_id: account.unit_id,
    ad_account_id: account.id,
    entity_id: campaignEntityId,
    decision_id: null,
    platform: account.platform,
    action_type: 'launch_campaign',
    payload_sent: spec as unknown as Record<string, unknown>,
    previous_state: {},
    result: outcome.result,
    external_response: {
      steps: outcome.steps,
      campaignExternalId: outcome.campaignExternalId,
      adSetExternalId: outcome.adSetExternalId,
      adExternalId: outcome.adExternalId,
    },
    error_message: outcome.error ?? null,
    executed_by: executedBy,
  })

  if (outcome.result === 'failed' || outcome.result === 'partial') {
    await logSystemEvent(supabase, {
      level: outcome.result === 'failed' ? 'error' : 'warning',
      source: account.platform === 'meta' ? 'meta_ads' : 'google_ads',
      eventType: `traffic_campaign_launch_${outcome.result}`,
      message: `Criação de campanha "${spec.name}" (${account.name}) terminou como ${outcome.result}: ${outcome.error ?? 'ver steps'}`,
      orgId: account.org_id,
      unitId: account.unit_id,
      metadata: { steps: outcome.steps },
    })
  }

  return outcome
}
