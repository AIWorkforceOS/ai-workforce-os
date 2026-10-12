import { localDateString } from './slot-engine'

/**
 * Decide o que fazer com o appointment já existente de uma ordem da
 * Facil-IT quando o sync revê o mesmo PO. Bug real (2026-10-12, Mawi Pro,
 * urgente): a Facil-IT reagenda/aprova a mesma ordem (mesmo PO, nova data
 * de visita — ex.: assessment feito, serviço aprovado), o sync só
 * atualizava visit_date em facilit_work_orders e o appointment antigo
 * (concluído/cotado, ou ainda na data velha) nunca era recriado nem
 * remarcado — a ordem de hoje não aparecia na Agenda.
 *
 * - 'new_appointment': o appointment antigo já foi finalizado/cotado e a
 *   Facil-IT agora marca uma visita em outro dia posterior → é uma visita
 *   nova (o antigo fica como histórico).
 * - 'reschedule': o appointment ainda está pendente e a Facil-IT mudou a
 *   data/hora da visita (ou ele ficou parado numa data já passada enquanto
 *   a Facil-IT aponta pro futuro) → remarca o mesmo appointment.
 * - 'none': nada a fazer (inclui ajuste manual do admin quando a Facil-IT
 *   não mudou nada).
 */
export type VisitReconcileAction = 'none' | 'reschedule' | 'new_appointment'

export type ExistingAppointmentForReconcile = {
  starts_at: string
  status: string | null
  service_order_status: string | null
}

export function decideVisitReconcile(params: {
  previousVisitDate: string | null
  newVisitDate: string | null
  appointment: ExistingAppointmentForReconcile
  timezone: string
  now: Date
}): VisitReconcileAction {
  const { previousVisitDate, newVisitDate, appointment, timezone, now } = params
  if (!newVisitDate) return 'none'

  const newVisit = new Date(newVisitDate)
  const apptStart = new Date(appointment.starts_at)
  if (Number.isNaN(newVisit.getTime()) || Number.isNaN(apptStart.getTime())) return 'none'
  if (newVisit.getTime() === apptStart.getTime()) return 'none'

  const todayLocal = localDateString(now, timezone)
  const newVisitLocal = localDateString(newVisit, timezone)
  const apptLocal = localDateString(apptStart, timezone)

  const finished =
    appointment.status === 'completed' ||
    appointment.service_order_status === 'completed' ||
    appointment.service_order_status === 'quote'

  if (finished) {
    return newVisit.getTime() > apptStart.getTime() && newVisitLocal !== apptLocal && newVisitLocal >= todayLocal
      ? 'new_appointment'
      : 'none'
  }

  if (appointment.status === 'cancelled' || appointment.status === 'no_show') return 'none'

  const visitChanged = previousVisitDate !== null && new Date(previousVisitDate).getTime() !== newVisit.getTime()
  const staleInPast = apptLocal < todayLocal && newVisitLocal >= todayLocal
  return visitChanged || staleInPast ? 'reschedule' : 'none'
}
