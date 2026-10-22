import type { SupabaseClient } from '@supabase/supabase-js'
import { monthRange } from '@/lib/service-operations-month'
import { addDaysIso, clientNameOf, type BillingRecord } from './by-client'

const SELECT =
  'id, service_date, amount_charged, due_date, invoice_id, payment_status, description, customer:customers(id, name, client_company), appointment:appointments(service_order_number, service_order_location_name), invoice:invoices(invoice_number, status, paid_at)'

type Row = {
  id: string
  service_date: string
  amount_charged: number | string | null
  due_date: string | null
  invoice_id: string | null
  payment_status: string | null
  description: string | null
  customer: { id: string; name: string | null; client_company: string | null } | null
  appointment: { service_order_number: string | null; service_order_location_name: string | null } | null
  invoice: { invoice_number: string | null; status: string | null; paid_at: string | null } | null
}

export function mapBillingRows(rows: Row[]): BillingRecord[] {
  return rows.map((r) => ({
    id: r.id,
    serviceDate: r.service_date,
    amount: r.amount_charged == null ? null : Number(r.amount_charged),
    dueDate: r.due_date,
    invoiceId: r.invoice_id,
    invoiceNumber: r.invoice?.invoice_number ?? null,
    invoiceStatus: r.invoice?.status ?? null,
    paid: r.payment_status === 'paid' || r.invoice?.status === 'paid',
    clientName: clientNameOf(r.customer),
    customerName: r.customer?.name ?? null,
    orderNumber: r.appointment?.service_order_number ?? null,
    locationName: r.appointment?.service_order_location_name ?? null,
    description: r.description,
  }))
}

/** Ordens do mês (pela data do serviço, como a Operação) com cliente, ordem de serviço e fatura. */
export async function fetchBillingRecords(supabase: SupabaseClient, unitId: string, month: string): Promise<{ records: BillingRecord[]; error: boolean }> {
  const { start, nextStart } = monthRange(month)
  const { data, error } = await supabase
    .from('service_records')
    .select(SELECT)
    .eq('unit_id', unitId)
    .gte('service_date', start)
    .lt('service_date', nextStart)
    .order('service_date', { ascending: true })
    .limit(1500)
  if (error) return { records: [], error: true }
  return { records: mapBillingRows((data ?? []) as unknown as Row[]), error: false }
}

/** Lembretes: ordens ainda sem fatura com vencimento até amanhã (de QUALQUER mês — uma ordem de setembro pode vencer hoje). */
export async function fetchReminderRecords(supabase: SupabaseClient, unitId: string, todayIso: string): Promise<BillingRecord[]> {
  const { data, error } = await supabase
    .from('service_records')
    .select(SELECT)
    .eq('unit_id', unitId)
    .is('invoice_id', null)
    .not('due_date', 'is', null)
    .lte('due_date', addDaysIso(todayIso, 1))
    .order('due_date', { ascending: true })
    .limit(500)
  if (error) return []
  return mapBillingRows((data ?? []) as unknown as Row[])
}
