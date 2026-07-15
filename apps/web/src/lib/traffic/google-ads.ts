// Cliente REST da Google Ads API (v24 — mid/2026).
//
// Referências oficiais (developers.google.com/google-ads/api):
//   - Auth REST: header Authorization (Bearer), developer-token e
//     login-customer-id (quando MCC opera contas de clientes).
//   - GAQL:   POST https://googleads.googleapis.com/v24/customers/{cid}/googleAds:search
//   - Mutate: POST .../v24/customers/{cid}/campaigns:mutate  (e campaignBudgets:mutate)
//   - Escopo OAuth: https://www.googleapis.com/auth/adwords
//   - Access token obtido do refresh token em https://www.googleapis.com/oauth2/v3/token
//
// Exige Developer Token aprovado pelo Google (nível Basic/Standard) —
// ver docs/setup/traffic-apis-setup.md.
//
// Degradação graciosa: sem credenciais, getGoogleAdsConfig retorna null.

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
