import type { SupabaseClient } from '@supabase/supabase-js'
import { DEFAULT_LOCALE, unitDefaultLocale, type Locale } from '@/lib/i18n/config'

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

export type PortalServiceOrderPhoto = { url: string; uploaded_at: string }

export type PortalAppointment = {
  id: string
  unit_id: string
  starts_at: string
  ends_at: string
  status: string
  address: string | null
  notes: string | null
  customers: { name: string } | null
  services: { name: string } | null
  /** Ordem de serviço anexada pelo admin (Fase A Mawi/360) — null quando não há ordem para este agendamento. */
  service_order_number: string | null
  service_order_file_url: string | null
  service_order_summary_pt: string | null
  service_order_status: 'pending' | 'completed' | 'quote'
  service_order_signed_by: string | null
  service_order_signed_at: string | null
  service_order_part_purchase_link: string | null
  service_order_photos: PortalServiceOrderPhoto[]
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
      .select(
        'id, unit_id, starts_at, ends_at, status, address, notes, customers(name), services(name), service_order_number, service_order_file_url, service_order_summary_pt, service_order_status, service_order_signed_by, service_order_signed_at, service_order_part_purchase_link, service_order_photos',
      )
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

export type EmployeeUnitContext = {
  timezone: string
  locale: Locale
}

const FALLBACK_TIMEZONE = 'America/Sao_Paulo'

/**
 * Fuso e idioma da unidade do funcionário — necessários pro seletor de
 * mês (lib/service-operations-month.ts espera timezone da unidade, não
 * do servidor) e pros rótulos/moeda do financeiro do portal. Dois
 * passos (employees -> units) porque não há join pronto; RLS cobre os
 * dois (employees_select libera a própria linha, units_select libera a
 * unidade do próprio usuário — migrations 005/034/053).
 */
export async function fetchEmployeeUnitContext(
  supabase: SupabaseClient,
  employeeId: string,
): Promise<EmployeeUnitContext> {
  const { data: employee } = await supabase
    .from('employees')
    .select('unit_id')
    .eq('id', employeeId)
    .maybeSingle()

  const unitId = (employee as { unit_id: string | null } | null)?.unit_id
  if (!unitId) return { timezone: FALLBACK_TIMEZONE, locale: DEFAULT_LOCALE }

  const { data: unit } = await supabase
    .from('units')
    .select('timezone, default_conversation_language')
    .eq('id', unitId)
    .maybeSingle()

  if (!unit) return { timezone: FALLBACK_TIMEZONE, locale: DEFAULT_LOCALE }
  const unitRow = unit as { timezone: string | null; default_conversation_language: Locale | null }

  return {
    timezone: unitRow.timezone ?? FALLBACK_TIMEZONE,
    locale: unitDefaultLocale({ default_conversation_language: unitRow.default_conversation_language }),
  }
}
