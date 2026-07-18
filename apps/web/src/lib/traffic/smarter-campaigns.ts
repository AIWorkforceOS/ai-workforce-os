import type { SupabaseClient } from '@supabase/supabase-js'
import { logSystemEvent } from '@/lib/system-events'
import type { Unit } from '@/lib/types'
import type { AdAccount, AdEntity } from './types'

// Cliente de campanhas de parceiros da Smarter (§ contrato POST/PATCH
// /api/partners/campaigns no Sistema Smarter).
//
// FRONTEIRA EXPLÍCITA: mesma regra de isolamento de lib/sales/smarter-crm.ts
// e lib/recruiter/smarter-api.ts — a Smarter é tratada como
// fornecedora/consumidora externa via API HTTP autorizada por token de
// parceiro DA UNIDADE (units.smarter_marketing_partner_token), nunca acesso
// direto a banco/código do Sistema Smarter (regra do CLAUDE.md).
//
// Ativado por unidade só por units.smarter_marketing_partner_token — não há
// um modo nativo×smarter como em CRM/Recruiting: é um espelhamento
// adicional opcional. Token ausente = este módulo não faz nenhuma chamada.

const SMARTER_MARKETING_API_BASE =
  process.env.SMARTER_MARKETING_API_URL ?? 'https://sistema.smarterestagios.com.br/api/partners/campaigns'

export type SmarterCampanhaPlataforma = 'meta' | 'google'
export type SmarterCampanhaStatus = 'ativa' | 'pausada'

/** Shape esperado do contrato de parceria (campos ausentes são tolerados). */
export type SmarterCampanha = { id: string; [key: string]: unknown }

export type CreateSmarterCampanhaInput = {
  plataforma: SmarterCampanhaPlataforma
  nomeCampanha: string
  externalCampaignId?: string | null
  objetivo: string
  orcamentoDiario: number
  status: SmarterCampanhaStatus
  dataInicio: string
  dataFim?: string | null
}

export type UpdateSmarterCampanhaInput = Partial<{
  gastoTotal: number
  impressoes: number
  cliques: number
  leadsGerados: number
  cpl: number
  roas: number
  status: SmarterCampanhaStatus
  dataFim: string | null
}>

async function smarterCampaignsRequest(
  method: 'POST' | 'PATCH',
  path: string,
  token: string,
  body: Record<string, unknown>,
): Promise<SmarterCampanha> {
  const response = await fetch(`${SMARTER_MARKETING_API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  })

  const data = await response.json().catch(() => null)

  if (!response.ok) {
    const message =
      data?.message ?? data?.error ?? `API de campanhas da Smarter retornou status ${response.status}`
    throw new Error(Array.isArray(message) ? message.join(', ') : String(message))
  }
  const campanha = data?.campanha ?? data
  if (!campanha?.id) throw new Error('API de campanhas da Smarter não retornou o id da campanha.')
  return campanha as SmarterCampanha
}

export async function createSmarterCampanha(
  token: string,
  input: CreateSmarterCampanhaInput,
): Promise<SmarterCampanha> {
  return smarterCampaignsRequest('POST', '', token, input)
}

export async function updateSmarterCampanha(
  token: string,
  smarterCampaignId: string,
  input: UpdateSmarterCampanhaInput,
): Promise<SmarterCampanha> {
  return smarterCampaignsRequest('PATCH', `/${smarterCampaignId}`, token, input)
}

/** Status normalizado do Alizo (ad_entities.status) para o enum fixo da Smarter. */
function mapStatus(status: AdEntity['status']): SmarterCampanhaStatus {
  return status === 'ACTIVE' ? 'ativa' : 'pausada'
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

type LifetimeTotals = {
  spend_cents: number
  impressions: number
  clicks: number
  conversions: number
  conversion_value_cents: number
}

async function fetchLifetimeTotals(supabase: SupabaseClient, entityId: string): Promise<LifetimeTotals> {
  const { data } = await supabase
    .from('ad_metrics_snapshots')
    .select('spend_cents, impressions, clicks, conversions, conversion_value_cents')
    .eq('entity_id', entityId)

  const rows = (data ?? []) as LifetimeTotals[]
  return rows.reduce(
    (acc, row) => ({
      spend_cents: acc.spend_cents + row.spend_cents,
      impressions: acc.impressions + row.impressions,
      clicks: acc.clicks + row.clicks,
      conversions: acc.conversions + row.conversions,
      conversion_value_cents: acc.conversion_value_cents + row.conversion_value_cents,
    }),
    { spend_cents: 0, impressions: 0, clicks: 0, conversions: 0, conversion_value_cents: 0 },
  )
}

/**
 * Sincroniza uma campanha (ad_entities.entity_level = 'campaign') com a
 * Smarter: cria lá na primeira vez (POST, guardando o id retornado em
 * ad_entities.smarter_campaign_id) e faz PATCH das métricas acumuladas nas
 * rodadas seguintes, correlacionando por esse id.
 *
 * Assunções documentadas (contrato não cobre 100% do nosso schema):
 * - objetivo: sempre 'leads' — todo o produto gira em torno de campanhas
 *   de captação de lead para franquias, então não há tradução confiável
 *   entre os objetivos brutos da plataforma (OUTCOME_LEADS, SEARCH...) e
 *   um enum da Smarter que não conhecemos.
 * - dataInicio: data de criação do registro local (created_at) — nenhuma
 *   das duas plataformas nos dá uma "data de início" estável e as duas
 *   normalizações atuais não capturam isso.
 * - orcamentoDiario: 0 quando ad_entities.daily_budget_cents é null
 *   (orçamento definido em outro nível da hierarquia).
 */
async function syncOneCampaign(
  supabase: SupabaseClient,
  token: string,
  account: AdAccount,
  entity: AdEntity,
): Promise<void> {
  const totals = await fetchLifetimeTotals(supabase, entity.id)
  const status = mapStatus(entity.status)

  if (!entity.smarter_campaign_id) {
    const created = await createSmarterCampanha(token, {
      plataforma: account.platform,
      nomeCampanha: entity.name,
      externalCampaignId: entity.external_id,
      objetivo: 'leads',
      orcamentoDiario: entity.daily_budget_cents != null ? round2(entity.daily_budget_cents / 100) : 0,
      status,
      dataInicio: entity.created_at.slice(0, 10),
      dataFim: null,
    })
    await supabase.from('ad_entities').update({ smarter_campaign_id: created.id }).eq('id', entity.id)
    return
  }

  const gastoTotal = round2(totals.spend_cents / 100)
  const patch: UpdateSmarterCampanhaInput = {
    gastoTotal,
    impressoes: totals.impressions,
    cliques: totals.clicks,
    leadsGerados: Math.round(totals.conversions),
    status,
  }
  if (patch.leadsGerados && patch.leadsGerados > 0) patch.cpl = round2(gastoTotal / patch.leadsGerados)
  if (totals.spend_cents > 0) patch.roas = round2(totals.conversion_value_cents / totals.spend_cents)
  if (status === 'pausada' && (entity.status === 'ARCHIVED' || entity.status === 'REMOVED')) {
    patch.dataFim = new Date().toISOString().slice(0, 10)
  }

  await updateSmarterCampanha(token, entity.smarter_campaign_id, patch)
}

/**
 * Ponto de entrada único da sincronização com a API de campanhas da
 * Smarter: roda para cada entidade de nível 'campaign' da conta. Nunca
 * lança — uma falha aqui não pode quebrar o cron real de tráfego, só fica
 * registrada em system_events para o time humano perceber. No-op quando a
 * unidade não tem smarter_marketing_partner_token configurado.
 */
export async function syncCampaignsToSmarterMarketing(
  supabase: SupabaseClient,
  unit: Unit,
  account: AdAccount,
  campaignEntities: AdEntity[],
): Promise<void> {
  if (!unit.smarter_marketing_partner_token) return

  for (const entity of campaignEntities) {
    try {
      await syncOneCampaign(supabase, unit.smarter_marketing_partner_token, account, entity)
    } catch (error) {
      await logSystemEvent(supabase, {
        level: 'error',
        source: 'traffic',
        eventType: entity.smarter_campaign_id
          ? 'smarter_marketing_update_failed'
          : 'smarter_marketing_create_failed',
        message: `Falha ao sincronizar campanha "${entity.name}" com a API de marketing da Smarter: ${error instanceof Error ? error.message : 'erro desconhecido'}`,
        orgId: account.org_id,
        unitId: account.unit_id,
        metadata: { entityId: entity.id, adAccountId: account.id },
      })
    }
  }
}
