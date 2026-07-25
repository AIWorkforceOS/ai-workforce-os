// Seleção da lista de destinatários de uma campanha de e-mail marketing —
// função pura (sem rede/DB) para ser testável e para ser reaproveitada
// tanto na prévia (contagem no rascunho) quanto na materialização real
// no momento da aprovação (lib/marketing-email/sender.ts).

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  AudienceCustomerRow,
  AudienceFilter,
  AudienceLeadRow,
  CampaignAudienceType,
  CampaignRecipientStatus,
  CampaignRecipientType,
} from './types'

/**
 * Busca de `leads`/`customers` só as colunas necessárias pra seleção de
 * audiência, pulando a tabela que a campanha nem usa. Compartilhado entre
 * a prévia (rota audience-preview, não grava nada) e a materialização
 * real na aprovação (lib/marketing-email/sender.ts).
 */
export async function fetchAudienceRows(
  supabase: SupabaseClient,
  unitId: string,
  audienceType: CampaignAudienceType,
): Promise<{ leads: AudienceLeadRow[]; customers: AudienceCustomerRow[] }> {
  const needsLeads = audienceType === 'leads' || audienceType === 'both'
  const needsCustomers = audienceType === 'customers' || audienceType === 'both'

  const [leadsRes, customersRes] = await Promise.all([
    needsLeads
      ? supabase.from('leads').select('id, email, status, last_contacted_at, marketing_opt_out, unsubscribe_token').eq('unit_id', unitId)
      : Promise.resolve({ data: [] as AudienceLeadRow[] }),
    needsCustomers
      ? supabase.from('customers').select('id, email, status, marketing_opt_out, unsubscribe_token').eq('unit_id', unitId)
      : Promise.resolve({ data: [] as AudienceCustomerRow[] }),
  ])

  return {
    leads: (leadsRes.data ?? []) as AudienceLeadRow[],
    customers: (customersRes.data ?? []) as AudienceCustomerRow[],
  }
}

export type AudienceSelectionRow = {
  recipientType: CampaignRecipientType
  recipientId: string
  email: string
  unsubscribeToken: string
}

export type AudienceSkippedRow = {
  recipientType: CampaignRecipientType
  recipientId: string
  unsubscribeToken: string
  reason: Extract<CampaignRecipientStatus, 'skipped_opt_out' | 'skipped_no_email'>
}

export type AudienceSelection = {
  included: AudienceSelectionRow[]
  skipped: AudienceSkippedRow[]
}

function isValidEmail(email: string | null): email is string {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
}

function isStale(lastContactedAt: string | null, staleDays: number | null | undefined, now: Date): boolean {
  if (!staleDays || staleDays <= 0) return true
  if (!lastContactedAt) return true
  const cutoff = now.getTime() - staleDays * 24 * 60 * 60 * 1000
  return new Date(lastContactedAt).getTime() < cutoff
}

/** Seleciona leads elegíveis (filtro de status + inatividade), separando quem foi excluído e por quê. */
export function selectLeadRecipients(
  leads: AudienceLeadRow[],
  filter: Pick<AudienceFilter, 'lead_statuses' | 'stale_days'>,
  now: Date = new Date(),
): AudienceSelection {
  const included: AudienceSelectionRow[] = []
  const skipped: AudienceSkippedRow[] = []

  for (const lead of leads) {
    if (filter.lead_statuses && filter.lead_statuses.length > 0 && !filter.lead_statuses.includes(lead.status)) {
      continue // fora do segmento escolhido — nem conta como "pulado" (nunca fez parte da lista)
    }
    if (!isStale(lead.last_contacted_at, filter.stale_days, now)) continue

    if (lead.marketing_opt_out) {
      skipped.push({ recipientType: 'lead', recipientId: lead.id, unsubscribeToken: lead.unsubscribe_token, reason: 'skipped_opt_out' })
      continue
    }
    if (!isValidEmail(lead.email)) {
      skipped.push({ recipientType: 'lead', recipientId: lead.id, unsubscribeToken: lead.unsubscribe_token, reason: 'skipped_no_email' })
      continue
    }
    included.push({ recipientType: 'lead', recipientId: lead.id, email: lead.email.trim(), unsubscribeToken: lead.unsubscribe_token })
  }

  return { included, skipped }
}

/** Seleciona clientes elegíveis (filtro de status ativo/inativo/todos). */
export function selectCustomerRecipients(
  customers: AudienceCustomerRow[],
  filter: Pick<AudienceFilter, 'customer_status'>,
): AudienceSelection {
  const included: AudienceSelectionRow[] = []
  const skipped: AudienceSkippedRow[] = []
  const wantedStatus = filter.customer_status ?? 'active'

  for (const customer of customers) {
    if (wantedStatus !== 'all' && customer.status !== wantedStatus) continue

    if (customer.marketing_opt_out) {
      skipped.push({
        recipientType: 'customer',
        recipientId: customer.id,
        unsubscribeToken: customer.unsubscribe_token,
        reason: 'skipped_opt_out',
      })
      continue
    }
    if (!isValidEmail(customer.email)) {
      skipped.push({
        recipientType: 'customer',
        recipientId: customer.id,
        unsubscribeToken: customer.unsubscribe_token,
        reason: 'skipped_no_email',
      })
      continue
    }
    included.push({
      recipientType: 'customer',
      recipientId: customer.id,
      email: customer.email.trim(),
      unsubscribeToken: customer.unsubscribe_token,
    })
  }

  return { included, skipped }
}

/** Combina as duas fontes conforme o tipo de audiência da campanha. */
export function buildAudience(params: {
  audienceType: CampaignAudienceType
  filter: AudienceFilter
  leads: AudienceLeadRow[]
  customers: AudienceCustomerRow[]
  now?: Date
}): AudienceSelection {
  const { audienceType, filter, leads, customers, now = new Date() } = params
  const parts: AudienceSelection[] = []

  if (audienceType === 'leads' || audienceType === 'both') {
    parts.push(selectLeadRecipients(leads, filter, now))
  }
  if (audienceType === 'customers' || audienceType === 'both') {
    parts.push(selectCustomerRecipients(customers, filter))
  }

  return {
    included: parts.flatMap((p) => p.included),
    skipped: parts.flatMap((p) => p.skipped),
  }
}
