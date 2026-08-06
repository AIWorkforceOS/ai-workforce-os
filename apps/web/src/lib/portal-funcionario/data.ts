import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Corte de dados do Portal do Funcionário: a Alizo começou a operar o
 * funcionário em agosto/2026, então o portal não precisa exibir (nem
 * migrar) histórico anterior. Decisão de produto temporária — não é
 * uma regra de segurança, por isso vive aqui e não no RLS.
 */
export const PORTAL_DATA_SINCE = '2026-08-01'

export function isOnOrAfterPortalStart(isoDate: string): boolean {
  return isoDate >= PORTAL_DATA_SINCE
}

export type PortalAppointment = {
  id: string
  starts_at: string
  ends_at: string
  status: string
  address: string | null
  notes: string | null
  customers: { name: string } | null
  services: { name: string } | null
}

export type PortalServiceRecord = {
  id: string
  service_date: string
  description: string | null
  amount_due: number | null
  /** já pago a este funcionário (migration 055) */
  amount_paid_to_employee: number
  payment_status: string
  paid_at: string | null
  customers: { name: string } | null
}

export type EmployeePortalData = {
  appointments: PortalAppointment[]
  serviceRecords: PortalServiceRecord[]
}

/**
 * Busca a agenda e o financeiro de UM funcionário (isolado por
 * employee_id — reforçado no RLS de appointments/service_records,
 * ver migration 052). Filtra para PORTAL_DATA_SINCE em diante.
 */
export async function fetchEmployeePortalData(
  supabase: SupabaseClient,
  employeeId: string,
): Promise<EmployeePortalData> {
  const [{ data: appointmentsData }, { data: serviceRecordsData }] = await Promise.all([
    supabase
      .from('appointments')
      .select('id, starts_at, ends_at, status, address, notes, customers(name), services(name)')
      .eq('employee_id', employeeId)
      .order('starts_at', { ascending: true }),
    supabase
      .from('service_records')
      .select('id, service_date, description, amount_due, amount_paid_to_employee, payment_status, paid_at, customers(name)')
      .eq('employee_id', employeeId)
      .order('service_date', { ascending: false }),
  ])

  const appointments = ((appointmentsData ?? []) as unknown as PortalAppointment[]).filter((a) =>
    isOnOrAfterPortalStart(a.starts_at),
  )
  const serviceRecords = ((serviceRecordsData ?? []) as unknown as PortalServiceRecord[]).filter((r) =>
    isOnOrAfterPortalStart(r.service_date),
  )

  return { appointments, serviceRecords }
}
