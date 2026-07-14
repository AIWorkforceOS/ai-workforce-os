import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Métricas da plataforma inteira para o painel Super Admin.
 *
 * Tudo roda com o client da sessão (RLS): as policies dão ao super
 * admin visão global, e as tabelas de custo (api_usage_events/daily)
 * são exclusivas dele. Cada função documenta o que é dado EXATO e o
 * que é APROXIMAÇÃO — o painel repete isso na interface.
 */

// Conversão USD→BRL usada só para exibir custo de API junto do DRE em
// R$. Aproximação: taxa fixa configurável por env, sem casar com a
// fatura real do cartão. Ajuste USD_BRL_RATE quando o câmbio mudar.
export const USD_BRL_RATE = Number(process.env.USD_BRL_RATE ?? 5.5)

export type FinancialRecordRow = {
  id: string
  org_id: string | null
  type: 'receivable' | 'payable'
  category: string
  description: string
  amount: number
  status: 'pending' | 'paid' | 'overdue' | 'cancelled'
  currency?: 'BRL' | 'USD' | null
  paid_at: string | null
  created_at: string
}

export type OrgRow = {
  id: string
  name: string
  plan: string
  is_active: boolean
  created_at: string
  cancelled_at?: string | null
}

export type ApiUsageDailyRow = {
  provider: 'openai' | 'google_maps' | 'resend' | 'evolution'
  day: string
  requests: number
  total_tokens: number
  estimated_cost_usd: number
}

export function startOfDay(date = new Date()): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

export function daysAgo(days: number): Date {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d
}

export function startOfMonth(date = new Date()): Date {
  const d = new Date(date)
  d.setDate(1)
  d.setHours(0, 0, 0, 0)
  return d
}

// ------------------------------------------------------------
// Visão em tempo real (cards do topo do painel)
// ------------------------------------------------------------

export type RealtimeOverview = {
  /** EXATO — mensagens registradas hoje em todas as unidades */
  conversationsToday: { leads: number; messages: number }
  /** EXATO — checkouts self-service registrados na semana (cobrança criada) */
  salesWeek: { count: number; totalBrl: number; totalUsd: number }
  /** EXATO — valor efetivamente marcado como pago na semana */
  collectedWeek: { totalBrl: number; totalUsd: number }
  /** EXATO se a migration 010 estiver aplicada; null = coluna ausente */
  cancellationsWeek: number | null
  /**
   * APROXIMAÇÃO — onboarding "concluído" = primeiro agente SDR ativado;
   * usa updated_at do agent_config como data de conclusão.
   */
  onboardingsWeek: number
  /**
   * DERIVADO — soma do que já foi PAGO por orgs canceladas dentro de
   * 7 dias após o cadastro (garantia). O reembolso em si é manual.
   */
  refundsDue: { totalBrl: number; totalUsd: number; orgs: { name: string; amountBrl: number; amountUsd: number }[] }
}

export async function getRealtimeOverview(supabase: SupabaseClient): Promise<RealtimeOverview> {
  const dayStart = startOfDay().toISOString()
  const weekStart = daysAgo(7).toISOString()

  const [convosRes, salesRes, orgsRes, agentsRes] = await Promise.all([
    supabase.from('conversations').select('lead_id').gte('sent_at', dayStart),
    supabase
      .from('financial_records')
      .select('*')
      .eq('type', 'receivable')
      .eq('category', 'client_payment')
      .gte('created_at', weekStart),
    supabase.from('organizations').select('id, name, created_at, cancelled_at'),
    supabase
      .from('agent_configs')
      .select('unit_id, updated_at')
      .eq('agent_type', 'sdr')
      .eq('is_active', true)
      .gte('updated_at', weekStart),
  ])

  const convos = (convosRes.data ?? []) as { lead_id: string | null }[]
  const sales = (salesRes.data ?? []) as FinancialRecordRow[]
  const agents = (agentsRes.data ?? []) as { unit_id: string; updated_at: string }[]

  // organizations.cancelled_at pode não existir ainda (migration 010)
  const orgsError = orgsRes.error
  const orgs = (orgsRes.data ?? []) as (OrgRow & { cancelled_at?: string | null })[]

  const sumByCurrency = (rows: FinancialRecordRow[]) => ({
    totalBrl: rows.filter((r) => (r.currency ?? 'BRL') === 'BRL').reduce((s, r) => s + Number(r.amount), 0),
    totalUsd: rows.filter((r) => r.currency === 'USD').reduce((s, r) => s + Number(r.amount), 0),
  })

  const paidWeek = sales.filter((r) => r.status === 'paid')

  let cancellationsWeek: number | null = null
  const refundsDue: RealtimeOverview['refundsDue'] = { totalBrl: 0, totalUsd: 0, orgs: [] }

  if (!orgsError) {
    const cancelledOrgs = orgs.filter((o) => o.cancelled_at)
    cancellationsWeek = cancelledOrgs.filter((o) => new Date(o.cancelled_at!) >= new Date(weekStart)).length

    // Garantia de 7 dias: cancelou até 7 dias após criar a conta →
    // devolver o que já foi pago (client_payment com status paid)
    const withinGuarantee = cancelledOrgs.filter((o) => {
      const created = new Date(o.created_at).getTime()
      const cancelled = new Date(o.cancelled_at!).getTime()
      return cancelled - created <= 7 * 24 * 60 * 60 * 1000
    })

    if (withinGuarantee.length > 0) {
      const ids = withinGuarantee.map((o) => o.id)
      const { data: paidRecords } = await supabase
        .from('financial_records')
        .select('*')
        .in('org_id', ids)
        .eq('type', 'receivable')
        .eq('category', 'client_payment')
        .eq('status', 'paid')

      const rows = (paidRecords ?? []) as FinancialRecordRow[]
      for (const org of withinGuarantee) {
        const orgRows = rows.filter((r) => r.org_id === org.id)
        if (orgRows.length === 0) continue
        const { totalBrl, totalUsd } = sumByCurrency(orgRows)
        refundsDue.totalBrl += totalBrl
        refundsDue.totalUsd += totalUsd
        refundsDue.orgs.push({ name: org.name, amountBrl: totalBrl, amountUsd: totalUsd })
      }
    }
  }

  return {
    conversationsToday: {
      leads: new Set(convos.map((c) => c.lead_id).filter(Boolean)).size,
      messages: convos.length,
    },
    salesWeek: { count: sales.length, ...sumByCurrency(sales) },
    collectedWeek: sumByCurrency(paidWeek),
    cancellationsWeek,
    onboardingsWeek: new Set(agents.map((a) => a.unit_id)).size,
    refundsDue,
  }
}

// ------------------------------------------------------------
// Custo e saúde por API
// ------------------------------------------------------------

export type ApiCostSummary = {
  provider: ApiUsageDailyRow['provider']
  requests: number
  totalTokens: number
  estimatedCostUsd: number
}

/**
 * Custo ESTIMADO acumulado no mês corrente, por provider, a partir dos
 * eventos que nós mesmos registramos (api_usage_events). Retorna null
 * se a migration 010 ainda não tiver sido aplicada.
 */
export async function getMonthApiCosts(supabase: SupabaseClient): Promise<ApiCostSummary[] | null> {
  const { data, error } = await supabase
    .from('api_usage_daily')
    .select('*')
    .gte('day', startOfMonth().toISOString())

  if (error) return null

  const rows = (data ?? []) as ApiUsageDailyRow[]
  const byProvider = new Map<string, ApiCostSummary>()
  for (const row of rows) {
    const current = byProvider.get(row.provider) ?? {
      provider: row.provider,
      requests: 0,
      totalTokens: 0,
      estimatedCostUsd: 0,
    }
    current.requests += Number(row.requests)
    current.totalTokens += Number(row.total_tokens)
    current.estimatedCostUsd += Number(row.estimated_cost_usd)
    byProvider.set(row.provider, current)
  }
  return [...byProvider.values()]
}

export type SystemEventLite = {
  source: string
  level: string
  message: string
  created_at: string
}

/** Eventos de erro/aviso das últimas 24h, por origem — alimenta a saúde dos cards. */
export async function getRecentApiIssues(supabase: SupabaseClient): Promise<SystemEventLite[]> {
  const { data } = await supabase
    .from('system_events')
    .select('source, level, message, created_at')
    .in('level', ['error', 'warning'])
    .gte('created_at', daysAgo(1).toISOString())
    .order('created_at', { ascending: false })
    .limit(200)
  return (data ?? []) as SystemEventLite[]
}

/** Indício de falta de créditos/limite na mensagem de erro. */
export function looksLikeQuotaIssue(message: string): boolean {
  return /quota|insufficient|billing|credit|429|payment required|402|exceeded|limit/i.test(message)
}

// ------------------------------------------------------------
// DRE mensal (aba Financeiro)
// ------------------------------------------------------------

export type MonthlyDre = {
  /** YYYY-MM */
  month: string
  label: string
  /** EXATO — receivables pagos no mês (paid_at, senão created_at), em R$ */
  revenueBrl: number
  revenueUsd: number
  /** EXATO — receivables criados e ainda pendentes */
  pendingBrl: number
  /** EXATO — payables pagos no mês */
  systemCostsBrl: number
  /** ESTIMADO — custo de APIs convertido a R$ pela USD_BRL_RATE */
  apiCostsBrl: number
  apiCostsUsd: number
  /** revenueBrl - systemCostsBrl - apiCostsBrl (USD convertido) */
  resultBrl: number
  /** % sobre a receita; null quando receita = 0 */
  marginPct: number | null
  newClients: number
  cancellations: number
  /** % cancelamentos / clientes ativos no início do mês; null sem base */
  churnPct: number | null
}

export function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export function monthsBetween(from: Date, to: Date): Date[] {
  const months: Date[] = []
  const cursor = new Date(from.getFullYear(), from.getMonth(), 1)
  const end = new Date(to.getFullYear(), to.getMonth(), 1)
  while (cursor <= end && months.length < 12) {
    months.push(new Date(cursor))
    cursor.setMonth(cursor.getMonth() + 1)
  }
  return months
}

export async function getMonthlyDre(
  supabase: SupabaseClient,
  from: Date,
  to: Date,
): Promise<{ months: MonthlyDre[]; apiCostsAvailable: boolean }> {
  const months = monthsBetween(from, to)
  const rangeStart = months[0]
  const lastMonth = months[months.length - 1]
  if (!rangeStart || !lastMonth) return { months: [], apiCostsAvailable: false }

  const rangeEnd = new Date(lastMonth)
  rangeEnd.setMonth(rangeEnd.getMonth() + 1)

  const [financialRes, orgsRes, usageRes] = await Promise.all([
    supabase
      .from('financial_records')
      .select('*')
      .gte('created_at', rangeStart.toISOString())
      .lt('created_at', rangeEnd.toISOString()),
    supabase.from('organizations').select('id, name, plan, is_active, created_at, cancelled_at'),
    supabase
      .from('api_usage_daily')
      .select('*')
      .gte('day', rangeStart.toISOString())
      .lt('day', rangeEnd.toISOString()),
  ])

  // Fallback: orgs sem a coluna cancelled_at (migration 010 pendente)
  let orgs = (orgsRes.data ?? []) as OrgRow[]
  if (orgsRes.error) {
    const { data } = await supabase.from('organizations').select('id, name, plan, is_active, created_at')
    orgs = ((data ?? []) as OrgRow[]).map((o) => ({ ...o, cancelled_at: null }))
  }

  const records = (financialRes.data ?? []) as FinancialRecordRow[]
  const usage = (usageRes.error ? [] : ((usageRes.data ?? []) as ApiUsageDailyRow[]))

  const result: MonthlyDre[] = months.map((monthStart) => {
    const key = monthKey(monthStart)
    const monthEnd = new Date(monthStart)
    monthEnd.setMonth(monthEnd.getMonth() + 1)

    const inMonth = (iso: string) => {
      const d = new Date(iso)
      return d >= monthStart && d < monthEnd
    }

    const paidInMonth = records.filter((r) => r.status === 'paid' && inMonth(r.paid_at ?? r.created_at))
    const revenueRows = paidInMonth.filter((r) => r.type === 'receivable')
    const revenueBrl = revenueRows
      .filter((r) => (r.currency ?? 'BRL') === 'BRL')
      .reduce((s, r) => s + Number(r.amount), 0)
    const revenueUsd = revenueRows.filter((r) => r.currency === 'USD').reduce((s, r) => s + Number(r.amount), 0)

    const pendingBrl = records
      .filter((r) => r.type === 'receivable' && r.status === 'pending' && inMonth(r.created_at))
      .filter((r) => (r.currency ?? 'BRL') === 'BRL')
      .reduce((s, r) => s + Number(r.amount), 0)

    const systemCostsBrl = paidInMonth
      .filter((r) => r.type === 'payable' && (r.currency ?? 'BRL') === 'BRL')
      .reduce((s, r) => s + Number(r.amount), 0)

    const apiCostsUsd = usage
      .filter((u) => inMonth(u.day))
      .reduce((s, u) => s + Number(u.estimated_cost_usd), 0)
    const apiCostsBrl = apiCostsUsd * USD_BRL_RATE

    // Receita consolidada em R$ (USD convertido pela taxa fixa)
    const revenueTotalBrl = revenueBrl + revenueUsd * USD_BRL_RATE
    const resultBrl = revenueTotalBrl - systemCostsBrl - apiCostsBrl
    const marginPct = revenueTotalBrl > 0 ? (resultBrl / revenueTotalBrl) * 100 : null

    const newClients = orgs.filter((o) => inMonth(o.created_at)).length
    const cancellations = orgs.filter((o) => o.cancelled_at && inMonth(o.cancelled_at)).length
    const activeAtStart = orgs.filter(
      (o) =>
        new Date(o.created_at) < monthStart &&
        (!o.cancelled_at || new Date(o.cancelled_at) >= monthStart),
    ).length
    const churnPct = activeAtStart > 0 ? (cancellations / activeAtStart) * 100 : null

    return {
      month: key,
      label: monthStart.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }),
      revenueBrl,
      revenueUsd,
      pendingBrl,
      systemCostsBrl,
      apiCostsBrl,
      apiCostsUsd,
      resultBrl,
      marginPct,
      newClients,
      cancellations,
      churnPct,
    }
  })

  return { months: result, apiCostsAvailable: !usageRes.error }
}
