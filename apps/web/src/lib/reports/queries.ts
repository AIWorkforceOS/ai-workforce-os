import type { SupabaseClient } from '@supabase/supabase-js'
import { summarizeServiceRecords, type ServiceRecordsSummary } from '@/lib/service-financials'
import { growthPercent } from './monthly-growth'
import { localDateString, zonedTimeToUtc } from '@/lib/slot-engine'
import { addDays } from '@/lib/calendar-dates'
import { monthRange, shiftMonth } from '@/lib/service-operations-month'

/**
 * Aba "Relatórios" (pedido do Vinicius, 2026-09-27, unidade Mawi Pro):
 * relatório por profissional/período e relatório mensal geral, sem
 * tocar em nada da Agenda/Operação existentes. Reaproveita
 * summarizeServiceRecords (mesma função já testada que alimenta a
 * Operação) e o seletor de mês já existente (service-operations-month.ts)
 * — só a composição das duas consultas (appointments pra contagem por
 * status, service_records pra valores) é nova.
 */

/** Mesmo vocabulário/valores do filtro de status da Agenda (calendar-view.tsx, STATUS_FILTER_OPTIONS) — não importado de lá porque não é exportado, mas os values/labels são idênticos de propósito. */
export type ReportServiceOrderStatusFilter = 'all' | 'pending' | 'completed' | 'quote'

export const REPORT_STATUS_OPTIONS: { value: ReportServiceOrderStatusFilter; label: string }[] = [
  { value: 'all', label: 'Todos os status' },
  { value: 'quote', label: 'Cotação' },
  { value: 'completed', label: 'Finalizado' },
  { value: 'pending', label: 'Pendente' },
]

export const PROFESSIONAL_REPORT_PERIODS = [30, 60, 90] as const
export type ProfessionalReportPeriod = (typeof PROFESSIONAL_REPORT_PERIODS)[number]

export function isProfessionalReportPeriod(value: unknown): value is ProfessionalReportPeriod {
  return (PROFESSIONAL_REPORT_PERIODS as readonly number[]).includes(value as number)
}

export type OrderStatusCounts = { total: number; pending: number; completed: number; quote: number }

function countByStatus(rows: { service_order_status: string | null }[]): OrderStatusCounts {
  const counts: OrderStatusCounts = { total: rows.length, pending: 0, completed: 0, quote: 0 }
  for (const row of rows) {
    if (row.service_order_status === 'pending') counts.pending += 1
    else if (row.service_order_status === 'completed') counts.completed += 1
    else if (row.service_order_status === 'quote') counts.quote += 1
  }
  return counts
}

export type ProfessionalReport = {
  employeeId: string
  periodDays: ProfessionalReportPeriod
  status: ReportServiceOrderStatusFilter
  orders: OrderStatusCounts
  financials: ServiceRecordsSummary
}

/**
 * Ordens (appointments, contagem por service_order_status) e valores
 * (service_records, via summarizeServiceRecords) de UM profissional nos
 * últimos N dias — as duas fontes ficam separadas de propósito (achado
 * real: hoje só 30 dos 202 service_records da Mawi Pro têm
 * appointment_id preenchido, não estão ligados o suficiente pra virar
 * uma métrica só).
 */
export async function fetchProfessionalReport(
  supabase: SupabaseClient,
  unitId: string,
  timezone: string,
  params: { employeeId: string; status: ReportServiceOrderStatusFilter; days: ProfessionalReportPeriod },
): Promise<ProfessionalReport> {
  const { employeeId, status, days } = params
  const todayLocal = localDateString(new Date(), timezone)
  const startLocal = addDays(todayLocal, -days)
  const rangeStartUtc = zonedTimeToUtc(startLocal, '00:00', timezone).toISOString()
  const rangeEndUtc = zonedTimeToUtc(addDays(todayLocal, 1), '00:00', timezone).toISOString()

  let appointmentsQuery = supabase
    .from('appointments')
    .select('id, service_order_status')
    .eq('unit_id', unitId)
    .eq('employee_id', employeeId)
    .gte('starts_at', rangeStartUtc)
    .lt('starts_at', rangeEndUtc)
  if (status !== 'all') appointmentsQuery = appointmentsQuery.eq('service_order_status', status)

  const [{ data: appointmentsData }, { data: serviceRecordsData }] = await Promise.all([
    appointmentsQuery,
    supabase
      .from('service_records')
      .select('amount_charged, amount_due, amount_paid_to_employee, invoice_id')
      .eq('unit_id', unitId)
      .eq('employee_id', employeeId)
      .gte('service_date', startLocal)
      .lte('service_date', todayLocal),
  ])

  return {
    employeeId,
    periodDays: days,
    status,
    orders: countByStatus((appointmentsData ?? []) as { service_order_status: string | null }[]),
    financials: summarizeServiceRecords(
      (serviceRecordsData ?? []) as { amount_charged: number | null; amount_due: number | null; amount_paid_to_employee: number; invoice_id: string | null }[],
    ),
  }
}

export type MonthlyReport = {
  month: string
  previousMonth: string
  orders: OrderStatusCounts
  financials: ServiceRecordsSummary
  uniqueCustomers: number
  revenueGrowthPercent: number | null
}

/**
 * Relatório geral do mês: valores + ordens atendidas/finalizadas/cotação
 * + clientes únicos + % de crescimento da receita (totalOrdersAmount)
 * vs o mês anterior. Reaproveita monthRange/shiftMonth já existentes
 * (mesmos usados na Operação) — nunca reimplementa cálculo de mês.
 */
export async function fetchMonthlyReport(
  supabase: SupabaseClient,
  unitId: string,
  timezone: string,
  month: string,
): Promise<MonthlyReport> {
  const { start, nextStart } = monthRange(month)
  const previousMonth = shiftMonth(month, -1)
  const { start: prevStart, nextStart: prevNextStart } = monthRange(previousMonth)

  const rangeStartUtc = zonedTimeToUtc(start, '00:00', timezone).toISOString()
  const rangeEndUtc = zonedTimeToUtc(nextStart, '00:00', timezone).toISOString()

  const [{ data: appointmentsData }, { data: serviceRecordsData }, { data: prevServiceRecordsData }] = await Promise.all([
    supabase
      .from('appointments')
      .select('id, customer_id, service_order_location_name, service_order_status')
      .eq('unit_id', unitId)
      .gte('starts_at', rangeStartUtc)
      .lt('starts_at', rangeEndUtc),
    supabase
      .from('service_records')
      .select('amount_charged, amount_due, amount_paid_to_employee, invoice_id')
      .eq('unit_id', unitId)
      .gte('service_date', start)
      .lt('service_date', nextStart),
    supabase
      .from('service_records')
      .select('amount_charged, amount_due, amount_paid_to_employee, invoice_id')
      .eq('unit_id', unitId)
      .gte('service_date', prevStart)
      .lt('service_date', prevNextStart),
  ])

  const appointments = (appointmentsData ?? []) as {
    id: string
    customer_id: string | null
    service_order_location_name: string | null
    service_order_status: string | null
  }[]
  const financials = summarizeServiceRecords(
    (serviceRecordsData ?? []) as { amount_charged: number | null; amount_due: number | null; amount_paid_to_employee: number; invoice_id: string | null }[],
  )
  const previousFinancials = summarizeServiceRecords(
    (prevServiceRecordsData ?? []) as { amount_charged: number | null; amount_due: number | null; amount_paid_to_employee: number; invoice_id: string | null }[],
  )
  // Achado real (2026-09-27, verificado contra os dados da Mawi Pro): ordens
  // importadas da Facil-IT compartilham TODAS o mesmo customer_id sintético
  // ("360 Service Provider", ver resolveFacilitCustomer em facilit-sync.ts) —
  // contar só por customer_id dava "1 cliente atendido" com 51 ordens reais
  // em 25 lojas diferentes no mesmo mês. service_order_location_name é a loja
  // de verdade nesse fluxo; cai pro customer_id quando a ordem não veio da
  // Facil-IT (não tem location_name, mas tem um customer_id real e distinto).
  const uniqueCustomers = new Set(
    appointments.map((a) => a.service_order_location_name ?? a.customer_id).filter((key): key is string => Boolean(key)),
  ).size

  return {
    month,
    previousMonth,
    orders: countByStatus(appointments),
    financials,
    uniqueCustomers,
    revenueGrowthPercent: growthPercent(financials.totalOrdersAmount, previousFinancials.totalOrdersAmount),
  }
}
