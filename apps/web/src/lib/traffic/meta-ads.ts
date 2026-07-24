// Cliente da Meta Marketing API (Graph API v25.0 — fev/2026).
//
// Endpoints usados (documentação oficial developers.facebook.com/docs/marketing-api):
//   GET  /act_{account_id}/campaigns?fields=...
//   GET  /act_{account_id}/adsets?fields=...
//   GET  /act_{account_id}/insights?level=...&time_range=...&fields=...
//   POST /{object_id}                     — atualizar status/orçamento
//   POST /act_{account_id}/campaigns      — criar campanha
//   POST /act_{account_id}/adsets         — criar conjunto de anúncios
//   POST /act_{account_id}/adcreatives    — criar criativo (texto)
//   POST /act_{account_id}/ads            — criar anúncio (liga adset + criativo)
//
// Escopos exigidos no access token: ads_read (leitura/insights) e
// ads_management (mutações, inclusive criação). Permissão avançada de
// ads_management exige App Review aprovado no app da Meta — ver
// docs/setup/traffic-apis-setup.md.
//
// Degradação graciosa: sem token configurado, getMetaConfig retorna null e
// o chamador registra system_event em vez de quebrar (padrão do OS). A
// criação de campanhas cai no fallback de mock em lib/traffic/launcher.ts
// quando isso acontece.
//
// -----------------------------------------------------------------------
// Pré-requisitos de criação por objective (não é possível criar QUALQUER
// campanha sem preparo prévio na conta — a Meta valida isso no servidor):
//   OUTCOME_AWARENESS / OUTCOME_TRAFFIC / OUTCOME_ENGAGEMENT
//     — nenhum pré-requisito além da conta ativa e uma Página do Facebook
//       (page_id) para servir de dono do criativo.
//   OUTCOME_LEADS
//     — sem formulário/CRM configurado, cai em LINK_CLICKS apontando pra
//       landing page; formulário instantâneo (Leads Ads nativo) não é
//       criado por este cliente (fora de escopo desta rodada).
//   OUTCOME_SALES (conversões)
//     — exige Pixel do Meta (ou Conversions API) já instalado no site E
//       um evento de conversão configurado; sem `metaPixelId` no spec,
//       a otimização cai para LINK_CLICKS em vez de OFFSITE_CONVERSIONS
//       (a campanha É criada, mas otimiza por clique, não por conversão —
//       documentar isso pro cliente antes de usar OUTCOME_SALES).
//   OUTCOME_APP_PROMOTION
//     — exige app registrado no Meta App Dashboard + SDK de app events;
//       não suportado por este cliente.
//   Special Ad Categories (crédito, emprego, moradia, política/eleições)
//     — campanhas nessas categorias têm segmentação restrita (sem idade/
//       gênero/CEP granular) e a Meta rejeita a criação se `targeting`
//       não respeitar essas regras. Este cliente sempre envia
//       special_ad_categories=[] — campanhas dessas categorias não são
//       suportadas nesta rodada.

import type {
  AdEntityStatus,
  PlatformEntity,
  PlatformMetricsRow,
} from './types'

export const META_API_VERSION = 'v25.0'
const META_BASE_URL = `https://graph.facebook.com/${META_API_VERSION}`

export type MetaConfig = {
  accessToken: string
  /** id da conta no formato act_<número> */
  adAccountId: string
}

/**
 * Resolve as credenciais Meta de uma conta conectada: token por conta
 * (ad_accounts.access_token) com fallback no token global de system user
 * (META_SYSTEM_USER_TOKEN). Retorna null quando nada está configurado.
 */
export function getMetaConfig(account: {
  external_account_id: string
  access_token: string | null
}): MetaConfig | null {
  const accessToken = account.access_token || process.env.META_SYSTEM_USER_TOKEN || null
  if (!accessToken) return null

  const adAccountId = account.external_account_id.startsWith('act_')
    ? account.external_account_id
    : `act_${account.external_account_id}`

  return { accessToken, adAccountId }
}

type MetaErrorBody = { error?: { message?: string; type?: string; code?: number } }

export async function metaFetch<T>(path: string, config: MetaConfig, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${META_BASE_URL}/${path}`)
  url.searchParams.set('access_token', config.accessToken)
  for (const [key, value] of Object.entries(params ?? {})) url.searchParams.set(key, value)

  const response = await fetch(url.toString())
  const data = (await response.json()) as T & MetaErrorBody

  if (!response.ok) {
    const err = data.error
    throw new Error(
      `Meta API ${path} falhou: ${err?.message ?? `status ${response.status}`}${err?.code ? ` (code ${err.code})` : ''}`,
    )
  }
  return data
}

async function metaPost<T>(path: string, config: MetaConfig, body: Record<string, string>): Promise<T> {
  const form = new URLSearchParams({ ...body, access_token: config.accessToken })

  const response = await fetch(`${META_BASE_URL}/${path}`, { method: 'POST', body: form })
  const data = (await response.json()) as T & MetaErrorBody

  if (!response.ok) {
    const err = data.error
    throw new Error(
      `Meta API POST /${path} falhou: ${err?.message ?? `status ${response.status}`}${err?.code ? ` (code ${err.code})` : ''}`,
    )
  }
  return data
}

// ---------------------------------------------------------------------------
// Normalização de respostas
// ---------------------------------------------------------------------------

export type MetaCampaignRow = {
  id: string
  name: string
  status: string
  effective_status?: string
  objective?: string
  daily_budget?: string
  bid_strategy?: string
}

export type MetaAdSetRow = MetaCampaignRow & { campaign_id: string }

export type MetaInsightsRow = {
  campaign_id?: string
  adset_id?: string
  date_start: string
  date_stop: string
  impressions?: string
  clicks?: string
  spend?: string
  reach?: string
  frequency?: string
  actions?: { action_type: string; value: string }[]
  action_values?: { action_type: string; value: string }[]
  purchase_roas?: { action_type: string; value: string }[]
}

function normalizeMetaStatus(status: string | undefined): AdEntityStatus {
  switch (status) {
    case 'ACTIVE':
      return 'ACTIVE'
    case 'PAUSED':
    case 'CAMPAIGN_PAUSED':
    case 'ADSET_PAUSED':
      return 'PAUSED'
    case 'ARCHIVED':
      return 'ARCHIVED'
    case 'DELETED':
      return 'REMOVED'
    default:
      return 'UNKNOWN'
  }
}

/** Meta devolve orçamento em centavos da moeda da conta, como string. */
function centsFromMetaBudget(value: string | undefined): number | null {
  if (!value) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.round(parsed) : null
}

/** spend da Meta vem em unidades da moeda (ex: "123.45") — convertemos para centavos. */
function centsFromMetaSpend(value: string | undefined): number {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0
}

/** Conversões: soma das actions relevantes (compra, lead, registro). */
const META_CONVERSION_ACTION_TYPES = new Set([
  'purchase',
  'omni_purchase',
  'offsite_conversion.fb_pixel_purchase',
  'lead',
  'onsite_conversion.lead_grouped',
  'offsite_conversion.fb_pixel_lead',
  'complete_registration',
  'offsite_conversion.fb_pixel_complete_registration',
])

export function sumMetaConversions(actions: MetaInsightsRow['actions']): number {
  if (!actions) return 0
  return actions
    .filter((a) => META_CONVERSION_ACTION_TYPES.has(a.action_type))
    .reduce((sum, a) => sum + (Number(a.value) || 0), 0)
}

export function sumMetaConversionValueCents(actionValues: MetaInsightsRow['action_values']): number {
  if (!actionValues) return 0
  const total = actionValues
    .filter((a) => META_CONVERSION_ACTION_TYPES.has(a.action_type))
    .reduce((sum, a) => sum + (Number(a.value) || 0), 0)
  return Math.round(total * 100)
}

export function normalizeMetaCampaign(row: MetaCampaignRow): PlatformEntity {
  return {
    platform: 'meta',
    entity_level: 'campaign',
    external_id: row.id,
    parent_external_id: null,
    name: row.name,
    status: normalizeMetaStatus(row.effective_status ?? row.status),
    objective: row.objective ?? null,
    daily_budget_cents: centsFromMetaBudget(row.daily_budget),
    bid_strategy: row.bid_strategy ?? null,
    raw: row as unknown as Record<string, unknown>,
  }
}

export function normalizeMetaAdSet(row: MetaAdSetRow): PlatformEntity {
  return {
    platform: 'meta',
    entity_level: 'ad_set',
    external_id: row.id,
    parent_external_id: row.campaign_id,
    name: row.name,
    status: normalizeMetaStatus(row.effective_status ?? row.status),
    objective: row.objective ?? null,
    daily_budget_cents: centsFromMetaBudget(row.daily_budget),
    bid_strategy: row.bid_strategy ?? null,
    raw: row as unknown as Record<string, unknown>,
  }
}

export function normalizeMetaInsights(
  row: MetaInsightsRow,
  level: 'campaign' | 'ad_set',
): PlatformMetricsRow {
  const externalId = level === 'campaign' ? row.campaign_id : row.adset_id
  return {
    entity_external_id: externalId ?? '',
    entity_level: level,
    date: row.date_start,
    impressions: Number(row.impressions ?? 0) || 0,
    clicks: Number(row.clicks ?? 0) || 0,
    spend_cents: centsFromMetaSpend(row.spend),
    conversions: sumMetaConversions(row.actions),
    conversion_value_cents: sumMetaConversionValueCents(row.action_values),
    reach: row.reach ? Number(row.reach) || null : null,
    frequency: row.frequency ? Number(row.frequency) || null : null,
    extra: row.purchase_roas ? { purchase_roas: row.purchase_roas } : {},
  }
}

// ---------------------------------------------------------------------------
// Chamadas à API
// ---------------------------------------------------------------------------

export type MetaAccountInfo = {
  id: string
  name: string
  /** 1 = ACTIVE; ver developers.facebook.com/docs/marketing-api/reference/ad-account#fields */
  account_status: number
  currency: string
}

/** Chamada leve usada para validar credenciais no fluxo de conexão self-service. */
export async function getMetaAccountInfo(config: MetaConfig): Promise<MetaAccountInfo> {
  return metaFetch<MetaAccountInfo>(config.adAccountId, config, {
    fields: 'name,account_status,currency',
  })
}

const CAMPAIGN_FIELDS = 'id,name,status,effective_status,objective,daily_budget,bid_strategy'
const ADSET_FIELDS = `${CAMPAIGN_FIELDS},campaign_id`
const INSIGHT_FIELDS =
  'campaign_id,adset_id,date_start,date_stop,impressions,clicks,spend,reach,frequency,actions,action_values,purchase_roas'

export async function listMetaCampaigns(config: MetaConfig): Promise<PlatformEntity[]> {
  const data = await metaFetch<{ data: MetaCampaignRow[] }>(`${config.adAccountId}/campaigns`, config, {
    fields: CAMPAIGN_FIELDS,
    limit: '200',
  })
  return (data.data ?? []).map(normalizeMetaCampaign)
}

export async function listMetaAdSets(config: MetaConfig): Promise<PlatformEntity[]> {
  const data = await metaFetch<{ data: MetaAdSetRow[] }>(`${config.adAccountId}/adsets`, config, {
    fields: ADSET_FIELDS,
    limit: '500',
  })
  return (data.data ?? []).map(normalizeMetaAdSet)
}

/**
 * Insights diários por campanha ou ad set dos últimos `days` dias
 * (time_increment=1 → uma linha por dia por entidade).
 */
export async function getMetaInsights(
  config: MetaConfig,
  level: 'campaign' | 'ad_set',
  days: number,
): Promise<PlatformMetricsRow[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const until = new Date().toISOString().slice(0, 10)

  const data = await metaFetch<{ data: MetaInsightsRow[] }>(`${config.adAccountId}/insights`, config, {
    level: level === 'ad_set' ? 'adset' : 'campaign',
    fields: INSIGHT_FIELDS,
    time_increment: '1',
    time_range: JSON.stringify({ since, until }),
    limit: '500',
  })
  return (data.data ?? [])
    .map((row) => normalizeMetaInsights(row, level))
    .filter((row) => row.entity_external_id)
}

/** Pausa ou reativa campanha/ad set (POST /{id} com status). Exige ads_management. */
export async function setMetaEntityStatus(
  config: MetaConfig,
  externalId: string,
  status: 'PAUSED' | 'ACTIVE',
): Promise<Record<string, unknown>> {
  return metaPost<Record<string, unknown>>(externalId, config, { status })
}

/** Ajusta orçamento diário (centavos da moeda da conta). Exige ads_management. */
export async function setMetaDailyBudget(
  config: MetaConfig,
  externalId: string,
  dailyBudgetCents: number,
): Promise<Record<string, unknown>> {
  return metaPost<Record<string, unknown>>(externalId, config, {
    daily_budget: String(Math.round(dailyBudgetCents)),
  })
}

// ---------------------------------------------------------------------------
// Criação (campanha do zero) — ver pré-requisitos por objective no topo do arquivo
// ---------------------------------------------------------------------------

/** Mapeia objective → optimization_goal do ad set (o que a Meta cobra no leilão). */
export function metaOptimizationGoalFor(objective: string, hasPixel: boolean): string {
  switch (objective) {
    case 'OUTCOME_SALES':
    case 'OUTCOME_LEADS':
      return hasPixel ? 'OFFSITE_CONVERSIONS' : 'LINK_CLICKS'
    case 'OUTCOME_AWARENESS':
      return 'REACH'
    case 'OUTCOME_ENGAGEMENT':
      return 'POST_ENGAGEMENT'
    case 'OUTCOME_TRAFFIC':
    default:
      return 'LINK_CLICKS'
  }
}

export type MetaCampaignCreateSpec = {
  name: string
  /** OUTCOME_AWARENESS | OUTCOME_TRAFFIC | OUTCOME_ENGAGEMENT | OUTCOME_LEADS | OUTCOME_SALES | OUTCOME_APP_PROMOTION */
  objective: string
  /** Campanha nasce sempre PAUSED — revisão humana liga (mesma trava de segurança do resto do OS). */
  status?: 'ACTIVE' | 'PAUSED'
}

/** POST /act_{account_id}/campaigns. Nunca cria em Special Ad Categories (ver header do arquivo). */
export async function createMetaCampaign(
  config: MetaConfig,
  spec: MetaCampaignCreateSpec,
): Promise<{ id: string }> {
  return metaPost<{ id: string }>(`${config.adAccountId}/campaigns`, config, {
    name: spec.name,
    objective: spec.objective,
    status: spec.status ?? 'PAUSED',
    special_ad_categories: JSON.stringify([]),
  })
}

export type MetaAdSetCreateSpec = {
  name: string
  campaignId: string
  dailyBudgetCents: number
  optimizationGoal: string
  billingEvent?: string
  bidAmountCents?: number
  status?: 'ACTIVE' | 'PAUSED'
  targeting: {
    countries: string[]
    ageMin?: number
    ageMax?: number
    interestIds?: string[]
  }
  /** Pixel do Meta — obrigatório quando optimizationGoal === 'OFFSITE_CONVERSIONS'. */
  promotedObjectPixelId?: string
}

/** POST /act_{account_id}/adsets. */
export async function createMetaAdSet(
  config: MetaConfig,
  spec: MetaAdSetCreateSpec,
): Promise<{ id: string }> {
  const targeting = {
    geo_locations: { countries: spec.targeting.countries },
    age_min: spec.targeting.ageMin ?? 18,
    age_max: spec.targeting.ageMax ?? 65,
    ...(spec.targeting.interestIds?.length
      ? { flexible_spec: [{ interests: spec.targeting.interestIds.map((id) => ({ id })) }] }
      : {}),
  }

  const body: Record<string, string> = {
    name: spec.name,
    campaign_id: spec.campaignId,
    daily_budget: String(Math.round(spec.dailyBudgetCents)),
    billing_event: spec.billingEvent ?? 'IMPRESSIONS',
    optimization_goal: spec.optimizationGoal,
    targeting: JSON.stringify(targeting),
    status: spec.status ?? 'PAUSED',
  }
  if (spec.bidAmountCents) body.bid_amount = String(Math.round(spec.bidAmountCents))
  if (spec.optimizationGoal === 'OFFSITE_CONVERSIONS' && spec.promotedObjectPixelId) {
    body.promoted_object = JSON.stringify({
      pixel_id: spec.promotedObjectPixelId,
      custom_event_type: 'PURCHASE',
    })
  }

  return metaPost<{ id: string }>(`${config.adAccountId}/adsets`, config, body)
}

export type MetaAdCreativeCreateSpec = {
  name: string
  /** obrigatório — id da Página do Facebook dona do anúncio */
  pageId: string
  message: string
  linkUrl: string
  headline?: string
  callToActionType?: string
}

/** POST /act_{account_id}/adcreatives — só texto/link nesta rodada (sem imagem/vídeo). */
export async function createMetaAdCreative(
  config: MetaConfig,
  spec: MetaAdCreativeCreateSpec,
): Promise<{ id: string }> {
  const objectStorySpec = {
    page_id: spec.pageId,
    link_data: {
      message: spec.message,
      link: spec.linkUrl,
      name: spec.headline,
      call_to_action: { type: spec.callToActionType ?? 'LEARN_MORE' },
    },
  }
  return metaPost<{ id: string }>(`${config.adAccountId}/adcreatives`, config, {
    name: spec.name,
    object_story_spec: JSON.stringify(objectStorySpec),
  })
}

export type MetaAdCreateSpec = {
  name: string
  adSetId: string
  creativeId: string
  status?: 'ACTIVE' | 'PAUSED'
}

/** POST /act_{account_id}/ads — liga ad set + criativo. */
export async function createMetaAd(config: MetaConfig, spec: MetaAdCreateSpec): Promise<{ id: string }> {
  return metaPost<{ id: string }>(`${config.adAccountId}/ads`, config, {
    name: spec.name,
    adset_id: spec.adSetId,
    creative: JSON.stringify({ creative_id: spec.creativeId }),
    status: spec.status ?? 'PAUSED',
  })
}
