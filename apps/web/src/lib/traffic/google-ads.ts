// Cliente REST da Google Ads API (v24 — mid/2026).
//
// Referências oficiais (developers.google.com/google-ads/api):
//   - Auth REST: header Authorization (Bearer), developer-token e
//     login-customer-id (quando MCC opera contas de clientes).
//   - GAQL:   POST https://googleads.googleapis.com/v24/customers/{cid}/googleAds:search
//   - Mutate: POST .../v24/customers/{cid}/campaigns:mutate  (e campaignBudgets:mutate,
//             adGroups:mutate, adGroupAds:mutate — criação usa os mesmos endpoints
//             de mutação, com operations[].create em vez de .update)
//   - Escopo OAuth: https://www.googleapis.com/auth/adwords
//   - Access token obtido do refresh token em https://www.googleapis.com/oauth2/v3/token
//
// Exige Developer Token aprovado pelo Google (nível Basic/Standard) —
// ver docs/setup/traffic-apis-setup.md. Criação de campanha também exige
// billing ativo na conta (sem forma de pagamento, o mutate de campaigns
// falha mesmo com token/developer token válidos).
//
// Degradação graciosa: sem credenciais, getGoogleAdsConfig retorna null. A
// criação de campanhas cai no fallback de mock em lib/traffic/launcher.ts
// quando isso acontece.
//
// -----------------------------------------------------------------------
// Cadeia de dependência para criar uma campanha do zero (a API do Google
// Ads é burocrática por design — cada recurso referencia o resourceName
// do anterior, criado numa chamada :mutate própria; não dá pra criar tudo
// numa chamada só como na Meta):
//
//   1. campaignBudgets:mutate  → cria o orçamento (recurso independente,
//      pode ser compartilhado entre campanhas — aqui sempre 1:1)
//   2. campaigns:mutate        → referencia campaignBudget=<resourceName do passo 1>;
//      exige também a estratégia de lance (oneof: manual_cpc, maximize_conversions,
//      target_spend... — ver createGoogleCampaign) e advertising_channel_type
//   3. adGroups:mutate         → referencia campaign=<resourceName do passo 2>
//   4. adGroupAds:mutate       → referencia adGroup=<resourceName do passo 3>
//
// Limitação desta rodada: só SEARCH tem o fluxo de anúncio completo
// (Responsive Search Ad — texto puro, sem imagem). DISPLAY/PERFORMANCE_MAX/
// VIDEO/DEMAND_GEN usam "asset groups" com creative de imagem/vídeo
// obrigatório — infraestrutura mais complexa que não foi construída aqui.
// Para esses canais, createGoogleCampaign funciona (campanha+orçamento
// criados), mas o launcher não tenta criar ad group/anúncio — documentar
// isso pro cliente antes de oferecer campanhas Display/PMax "completas".
// Keywords do ad group de Search (adGroupCriteria:mutate) também não são
// criadas nesta rodada — o ad group nasce sem termos de busca; alguém
// precisa adicionar keywords manualmente antes de tirar a campanha de PAUSED.

import type { AdEntityStatus, PlatformEntity, PlatformMetricsRow } from './types'

export const GOOGLE_ADS_API_VERSION = 'v24'
const GOOGLE_ADS_BASE_URL = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}`
const GOOGLE_OAUTH_TOKEN_URL = 'https://www.googleapis.com/oauth2/v3/token'

export type GoogleAdsConfig = {
  developerToken: string
  clientId: string
  clientSecret: string
  refreshToken: string
  /** customer id da conta operada, sem hífens */
  customerId: string
  /** customer id do MCC (login-customer-id), quando aplicável */
  loginCustomerId: string | null
}

/**
 * Resolve as credenciais Google Ads de uma conta conectada: refresh token
 * por conta (ad_accounts.refresh_token) + credenciais de app/developer
 * token globais por env. Retorna null quando algo essencial falta.
 *
 * Contas que aceitaram o vínculo com a MCC da Alizo (fluxo padrão do
 * self-service) não precisam de refresh_token nem developer token
 * próprios — tudo cai nos fallbacks globais e só o Customer ID
 * (external_account_id) é necessário. Os campos google_* só importam
 * para clientes com sua própria credencial de app OAuth (avançado).
 */
export function getGoogleAdsConfig(account: {
  external_account_id: string
  refresh_token: string | null
  google_developer_token?: string | null
  google_client_id?: string | null
  google_client_secret?: string | null
}): GoogleAdsConfig | null {
  const developerToken = account.google_developer_token || process.env.GOOGLE_ADS_DEVELOPER_TOKEN
  const clientId = account.google_client_id || process.env.GOOGLE_ADS_CLIENT_ID
  const clientSecret = account.google_client_secret || process.env.GOOGLE_ADS_CLIENT_SECRET
  const refreshToken = account.refresh_token || process.env.GOOGLE_ADS_REFRESH_TOKEN

  if (!developerToken || !clientId || !clientSecret || !refreshToken) return null

  return {
    developerToken,
    clientId,
    clientSecret,
    refreshToken,
    customerId: account.external_account_id.replace(/-/g, ''),
    loginCustomerId: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.replace(/-/g, '') ?? null,
  }
}

/** Troca o refresh token por um access token OAuth de curta duração. */
export async function getGoogleAccessToken(config: GoogleAdsConfig): Promise<string> {
  const response = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: config.refreshToken,
    }),
  })

  const data = (await response.json()) as { access_token?: string; error_description?: string }
  if (!response.ok || !data.access_token) {
    throw new Error(`Google OAuth falhou: ${data.error_description ?? `status ${response.status}`}`)
  }
  return data.access_token
}

async function googleAdsPost<T>(
  config: GoogleAdsConfig,
  accessToken: string,
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': config.developerToken,
    'Content-Type': 'application/json',
  }
  if (config.loginCustomerId) headers['login-customer-id'] = config.loginCustomerId

  const response = await fetch(`${GOOGLE_ADS_BASE_URL}/${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })

  const data = (await response.json()) as T & { error?: { message?: string } }
  if (!response.ok) {
    throw new Error(`Google Ads API ${path} falhou: ${data.error?.message ?? `status ${response.status}`}`)
  }
  return data
}

/** Executa uma consulta GAQL via googleAds:search (paginação simples). */
export async function searchGAQL(
  config: GoogleAdsConfig,
  accessToken: string,
  query: string,
): Promise<GoogleAdsSearchRow[]> {
  const rows: GoogleAdsSearchRow[] = []
  let pageToken: string | undefined

  do {
    const data = await googleAdsPost<{ results?: GoogleAdsSearchRow[]; nextPageToken?: string }>(
      config,
      accessToken,
      `customers/${config.customerId}/googleAds:search`,
      { query, ...(pageToken ? { pageToken } : {}) },
    )
    rows.push(...(data.results ?? []))
    pageToken = data.nextPageToken
  } while (pageToken)

  return rows
}

// ---------------------------------------------------------------------------
// Normalização de respostas
// ---------------------------------------------------------------------------

export type GoogleAdsSearchRow = {
  customer?: {
    resourceName?: string
    id?: string
    descriptiveName?: string
    currencyCode?: string
  }
  campaign?: {
    resourceName?: string
    id?: string
    name?: string
    status?: string
    advertisingChannelType?: string
    biddingStrategyType?: string
    campaignBudget?: string
  }
  campaignBudget?: { resourceName?: string; amountMicros?: string }
  adGroup?: {
    resourceName?: string
    id?: string
    name?: string
    status?: string
    campaign?: string
  }
  metrics?: {
    impressions?: string
    clicks?: string
    costMicros?: string
    conversions?: number | string
    conversionsValue?: number | string
  }
  segments?: { date?: string }
}

function normalizeGoogleStatus(status: string | undefined): AdEntityStatus {
  switch (status) {
    case 'ENABLED':
      return 'ACTIVE'
    case 'PAUSED':
      return 'PAUSED'
    case 'REMOVED':
      return 'REMOVED'
    default:
      return 'UNKNOWN'
  }
}

/** Google usa micros (1/1.000.000 da moeda) — convertemos para centavos. */
export function centsFromMicros(micros: string | number | undefined): number {
  const parsed = Number(micros ?? 0)
  return Number.isFinite(parsed) ? Math.round(parsed / 10_000) : 0
}

export function normalizeGoogleCampaign(row: GoogleAdsSearchRow): PlatformEntity | null {
  const campaign = row.campaign
  if (!campaign?.id) return null

  return {
    platform: 'google',
    entity_level: 'campaign',
    external_id: String(campaign.id),
    parent_external_id: null,
    name: campaign.name ?? `Campanha ${campaign.id}`,
    status: normalizeGoogleStatus(campaign.status),
    objective: campaign.advertisingChannelType ?? null,
    daily_budget_cents: row.campaignBudget?.amountMicros
      ? centsFromMicros(row.campaignBudget.amountMicros)
      : null,
    bid_strategy: campaign.biddingStrategyType ?? null,
    raw: row as unknown as Record<string, unknown>,
  }
}

export function normalizeGoogleMetrics(row: GoogleAdsSearchRow): PlatformMetricsRow | null {
  const campaignId = row.campaign?.id
  const date = row.segments?.date
  if (!campaignId || !date) return null

  return {
    entity_external_id: String(campaignId),
    entity_level: 'campaign',
    date,
    impressions: Number(row.metrics?.impressions ?? 0) || 0,
    clicks: Number(row.metrics?.clicks ?? 0) || 0,
    spend_cents: centsFromMicros(row.metrics?.costMicros),
    conversions: Number(row.metrics?.conversions ?? 0) || 0,
    conversion_value_cents: Math.round((Number(row.metrics?.conversionsValue ?? 0) || 0) * 100),
    reach: null,
    frequency: null,
  }
}

// ---------------------------------------------------------------------------
// Consultas e mutações
// ---------------------------------------------------------------------------

export type GoogleCustomerInfo = { id: string; descriptiveName: string | null; currencyCode: string | null }

/** Chamada leve usada para validar credenciais no fluxo de conexão self-service. */
export async function getGoogleCustomerInfo(
  config: GoogleAdsConfig,
  accessToken: string,
): Promise<GoogleCustomerInfo> {
  const rows = await searchGAQL(
    config,
    accessToken,
    'SELECT customer.id, customer.descriptive_name, customer.currency_code FROM customer LIMIT 1',
  )
  const customer = rows[0]?.customer
  if (!customer?.id) {
    throw new Error('Google Ads não retornou dados da conta — confira o Customer ID informado.')
  }
  return {
    id: String(customer.id),
    descriptiveName: customer.descriptiveName ?? null,
    currencyCode: customer.currencyCode ?? null,
  }
}

export async function listGoogleCampaigns(
  config: GoogleAdsConfig,
  accessToken: string,
): Promise<PlatformEntity[]> {
  const rows = await searchGAQL(
    config,
    accessToken,
    `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
            campaign.bidding_strategy_type, campaign.campaign_budget,
            campaign_budget.amount_micros
     FROM campaign
     WHERE campaign.status != 'REMOVED'`,
  )
  return rows
    .map(normalizeGoogleCampaign)
    .filter((entity): entity is PlatformEntity => entity !== null)
}

export async function getGoogleCampaignMetrics(
  config: GoogleAdsConfig,
  accessToken: string,
  days: number,
): Promise<PlatformMetricsRow[]> {
  const rows = await searchGAQL(
    config,
    accessToken,
    `SELECT campaign.id, segments.date, metrics.impressions, metrics.clicks,
            metrics.cost_micros, metrics.conversions, metrics.conversions_value
     FROM campaign
     WHERE segments.date DURING LAST_${days <= 7 ? '7' : days <= 14 ? '14' : '30'}_DAYS
       AND campaign.status != 'REMOVED'`,
  )
  return rows
    .map(normalizeGoogleMetrics)
    .filter((row): row is PlatformMetricsRow => row !== null)
}

/** Pausa/reativa campanha via campaigns:mutate (update com updateMask=status). */
export async function setGoogleCampaignStatus(
  config: GoogleAdsConfig,
  accessToken: string,
  campaignExternalId: string,
  status: 'PAUSED' | 'ACTIVE',
): Promise<Record<string, unknown>> {
  return googleAdsPost<Record<string, unknown>>(
    config,
    accessToken,
    `customers/${config.customerId}/campaigns:mutate`,
    {
      operations: [
        {
          update: {
            resourceName: `customers/${config.customerId}/campaigns/${campaignExternalId}`,
            status: status === 'ACTIVE' ? 'ENABLED' : 'PAUSED',
          },
          updateMask: 'status',
        },
      ],
    },
  )
}

/**
 * Ajusta o orçamento diário via campaignBudgets:mutate. Precisa do
 * resource name do budget (campaign.campaign_budget, guardado em raw).
 */
export async function setGoogleCampaignBudget(
  config: GoogleAdsConfig,
  accessToken: string,
  budgetResourceName: string,
  dailyBudgetCents: number,
): Promise<Record<string, unknown>> {
  return googleAdsPost<Record<string, unknown>>(
    config,
    accessToken,
    `customers/${config.customerId}/campaignBudgets:mutate`,
    {
      operations: [
        {
          update: {
            resourceName: budgetResourceName,
            amountMicros: String(Math.round(dailyBudgetCents) * 10_000),
          },
          updateMask: 'amount_micros',
        },
      ],
    },
  )
}

// ---------------------------------------------------------------------------
// Criação (campanha do zero) — ver cadeia de dependência no topo do arquivo
// ---------------------------------------------------------------------------

type MutateResult = { results?: { resourceName?: string }[] }

function firstResourceName(data: MutateResult, step: string): string {
  const resourceName = data.results?.[0]?.resourceName
  if (!resourceName) throw new Error(`Google Ads ${step}: resposta sem resourceName.`)
  return resourceName
}

/** Passo 1: campaignBudgets:mutate — orçamento independente, referenciado pela campanha. */
export async function createGoogleCampaignBudget(
  config: GoogleAdsConfig,
  accessToken: string,
  name: string,
  dailyBudgetCents: number,
): Promise<{ resourceName: string }> {
  const data = await googleAdsPost<MutateResult>(
    config,
    accessToken,
    `customers/${config.customerId}/campaignBudgets:mutate`,
    {
      operations: [
        {
          create: {
            name: `${name} — Orçamento`,
            amountMicros: String(Math.round(dailyBudgetCents) * 10_000),
            deliveryMethod: 'STANDARD',
            explicitlyShared: false,
          },
        },
      ],
    },
  )
  return { resourceName: firstResourceName(data, 'campaignBudgets:mutate') }
}

export type GoogleBiddingStrategy = 'MANUAL_CPC' | 'MAXIMIZE_CONVERSIONS' | 'TARGET_SPEND'

/**
 * Campo de bidding scheme (oneof) exigido pela API no create — não basta
 * mandar biddingStrategyType (é somente-leitura, derivado do oneof setado).
 * MAXIMIZE_CONVERSIONS/TARGET_CPA exigem conversion tracking configurado
 * na conta para funcionar de verdade; sem isso a Google aceita a criação
 * mas a campanha não otimiza (mesma ressalva do OFFSITE_CONVERSIONS na Meta).
 */
function googleBiddingSchemeField(strategy: GoogleBiddingStrategy): Record<string, unknown> {
  switch (strategy) {
    case 'MAXIMIZE_CONVERSIONS':
      return { maximizeConversions: {} }
    case 'TARGET_SPEND':
      return { targetSpend: {} }
    case 'MANUAL_CPC':
    default:
      return { manualCpc: { enhancedCpcEnabled: false } }
  }
}

export type GoogleCampaignCreateSpec = {
  name: string
  /** SEARCH é o único canal com fluxo de anúncio completo nesta rodada — ver header do arquivo. */
  channelType: string
  biddingStrategy?: GoogleBiddingStrategy
  status?: 'ENABLED' | 'PAUSED'
}

/** Passo 2: campaigns:mutate — referencia o resourceName do orçamento (passo 1). */
export async function createGoogleCampaign(
  config: GoogleAdsConfig,
  accessToken: string,
  spec: GoogleCampaignCreateSpec,
  budgetResourceName: string,
): Promise<{ resourceName: string }> {
  const data = await googleAdsPost<MutateResult>(
    config,
    accessToken,
    `customers/${config.customerId}/campaigns:mutate`,
    {
      operations: [
        {
          create: {
            name: spec.name,
            advertisingChannelType: spec.channelType,
            status: spec.status ?? 'PAUSED',
            campaignBudget: budgetResourceName,
            ...googleBiddingSchemeField(spec.biddingStrategy ?? 'MANUAL_CPC'),
            ...(spec.channelType === 'SEARCH'
              ? { networkSettings: { targetGoogleSearch: true, targetSearchNetwork: false, targetContentNetwork: false } }
              : {}),
          },
        },
      ],
    },
  )
  return { resourceName: firstResourceName(data, 'campaigns:mutate') }
}

export type GoogleAdGroupCreateSpec = {
  name: string
  status?: 'ENABLED' | 'PAUSED'
  cpcBidCents?: number
}

/** Passo 3: adGroups:mutate — referencia o resourceName da campanha (passo 2). */
export async function createGoogleAdGroup(
  config: GoogleAdsConfig,
  accessToken: string,
  spec: GoogleAdGroupCreateSpec,
  campaignResourceName: string,
): Promise<{ resourceName: string }> {
  const data = await googleAdsPost<MutateResult>(
    config,
    accessToken,
    `customers/${config.customerId}/adGroups:mutate`,
    {
      operations: [
        {
          create: {
            name: spec.name,
            campaign: campaignResourceName,
            status: spec.status ?? 'PAUSED',
            type: 'SEARCH_STANDARD',
            ...(spec.cpcBidCents ? { cpcBidMicros: String(Math.round(spec.cpcBidCents) * 10_000) } : {}),
          },
        },
      ],
    },
  )
  return { resourceName: firstResourceName(data, 'adGroups:mutate') }
}

export type GoogleResponsiveSearchAdSpec = {
  /** mínimo 3 exigido pela API (máx. 15, 30 caracteres cada) */
  headlines: string[]
  /** mínimo 2 exigido pela API (máx. 4, 90 caracteres cada) */
  descriptions: string[]
  finalUrls: string[]
  status?: 'ENABLED' | 'PAUSED'
}

/** Passo 4: adGroupAds:mutate — Responsive Search Ad (texto puro, sem imagem/vídeo). */
export async function createGoogleResponsiveSearchAd(
  config: GoogleAdsConfig,
  accessToken: string,
  spec: GoogleResponsiveSearchAdSpec,
  adGroupResourceName: string,
): Promise<{ resourceName: string }> {
  if (spec.headlines.length < 3) {
    throw new Error('Responsive Search Ad exige ao menos 3 headlines.')
  }
  if (spec.descriptions.length < 2) {
    throw new Error('Responsive Search Ad exige ao menos 2 descriptions.')
  }

  const data = await googleAdsPost<MutateResult>(
    config,
    accessToken,
    `customers/${config.customerId}/adGroupAds:mutate`,
    {
      operations: [
        {
          create: {
            adGroup: adGroupResourceName,
            status: spec.status ?? 'PAUSED',
            ad: {
              finalUrls: spec.finalUrls,
              responsiveSearchAd: {
                headlines: spec.headlines.map((text) => ({ text })),
                descriptions: spec.descriptions.map((text) => ({ text })),
              },
            },
          },
        },
      ],
    },
  )
  return { resourceName: firstResourceName(data, 'adGroupAds:mutate') }
}
