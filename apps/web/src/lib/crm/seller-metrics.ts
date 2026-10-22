import { dueBucket } from './activities'

export type MetricLead = { id: string; status: string; owner_user_id: string | null; created_at: string; updated_at: string; unit_id: string }
export type MetricActivity = { lead_id: string; kind: string; created_by: string | null; created_at: string; due_at: string | null; done_at: string | null }
export type MetricUser = { id: string; name: string | null; email: string }

export type SellerRow = {
  userId: string | null // null = leads sem responsável
  name: string
  assigned: number
  active: number
  won: number
  lost: number
  /** convertidos ÷ leads atribuídos (0 quando não há leads) */
  conversionRate: number
  /** convertidos no período: lead em "Convertido" cuja última atualização caiu no período (o sistema não guarda a data exata da conversão) */
  wonInPeriod: number
  newInPeriod: number
  calls: number
  messages: number
  notes: number
  followupsDone: number
  overdueFollowups: number
  /** leads ativos sem nenhum registro na linha do tempo no período */
  untouched: number
}

const ACTIVE = new Set(['new', 'contacted', 'replied', 'negotiating'])

/**
 * Métricas por vendedor (responsável do lead). Atividade (ligações, mensagens, notas) conta por QUEM registrou no período;
 * retornos atrasados contam por responsável do lead. Lógica pura: o período é [now - days, now].
 */
export function sellerMetrics(input: { leads: MetricLead[]; activities: MetricActivity[]; users: MetricUser[]; now: Date; days: number; timeZone: string }): SellerRow[] {
  const since = input.now.getTime() - input.days * 86_400_000
  const inPeriod = (iso: string) => new Date(iso).getTime() >= since
  const leadOwner = new Map(input.leads.map((l) => [l.id, l.owner_user_id]))
  const touchedLeads = new Set(input.activities.filter((a) => inPeriod(a.created_at)).map((a) => a.lead_id))

  const blank = (userId: string | null, name: string): SellerRow => ({ userId, name, assigned: 0, active: 0, won: 0, lost: 0, conversionRate: 0, wonInPeriod: 0, newInPeriod: 0, calls: 0, messages: 0, notes: 0, followupsDone: 0, overdueFollowups: 0, untouched: 0 })
  const rows = new Map<string | null, SellerRow>()
  for (const u of input.users) rows.set(u.id, blank(u.id, u.name || u.email))
  rows.set(null, blank(null, 'Sem responsável'))
  const row = (id: string | null) => {
    if (!rows.has(id)) rows.set(id, blank(id, 'Usuário removido'))
    return rows.get(id)!
  }

  for (const l of input.leads) {
    const r = row(l.owner_user_id)
    r.assigned += 1
    if (ACTIVE.has(l.status)) {
      r.active += 1
      if (!touchedLeads.has(l.id)) r.untouched += 1
    }
    if (l.status === 'won') {
      r.won += 1
      if (inPeriod(l.updated_at)) r.wonInPeriod += 1
    }
    if (l.status === 'lost') r.lost += 1
    if (inPeriod(l.created_at)) r.newInPeriod += 1
  }

  for (const a of input.activities) {
    if (inPeriod(a.created_at) && a.created_by) {
      const r = row(a.created_by)
      if (a.kind === 'call') r.calls += 1
      else if (a.kind === 'message') r.messages += 1
      else if (a.kind === 'note') r.notes += 1
    }
    if ((a.kind === 'followup' || a.kind === 'task') && a.done_at && inPeriod(a.done_at) && a.created_by) row(a.created_by).followupsDone += 1
    if ((a.kind === 'followup' || a.kind === 'task') && !a.done_at && a.due_at && dueBucket(a.due_at, input.now, input.timeZone) === 'overdue') {
      row(leadOwner.get(a.lead_id) ?? null).overdueFollowups += 1
    }
  }

  for (const r of rows.values()) r.conversionRate = r.assigned > 0 ? Math.round((r.won / r.assigned) * 100) : 0
  return [...rows.values()]
    .filter((r) => r.userId !== null || r.assigned > 0)
    .sort((a, b) => b.wonInPeriod - a.wonInPeriod || b.won - a.won || b.assigned - a.assigned || a.name.localeCompare(b.name, 'pt-BR'))
}

export function totalsOf(rows: SellerRow[]): { assigned: number; won: number; wonInPeriod: number; overdueFollowups: number; untouched: number } {
  return rows.reduce((t, r) => ({ assigned: t.assigned + r.assigned, won: t.won + r.won, wonInPeriod: t.wonInPeriod + r.wonInPeriod, overdueFollowups: t.overdueFollowups + r.overdueFollowups, untouched: t.untouched + r.untouched }), { assigned: 0, won: 0, wonInPeriod: 0, overdueFollowups: 0, untouched: 0 })
}
