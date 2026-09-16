import type { AppointmentStatus } from '@/lib/types'

/** Valor sintético só de apresentação — "quote" nunca existe em `appointments.status` de verdade, só no selo. */
export type EffectiveDisplayStatus = AppointmentStatus | 'quote'

/**
 * O selo principal da Agenda mostrava só `appointment.status`
 * (agendado/confirmado/concluído — só muda quando o admin clica
 * "Concluir", que também lança o service_records no financeiro), nunca
 * `service_order_status` (controlado pelo técnico ao assinar no
 * Portal do Funcionário) — achado real (2026-09-15): o técnico
 * finalizava e assinava a ordem, mas o selo principal continuava
 * "Agendado", porque são dois campos distintos que nunca se
 * sincronizavam.
 *
 * Revisado (2026-09-16, teste real do Vinicius): uma ordem de COTAÇÃO
 * finalizada precisa de um selo próprio ("Cotação"), distinto de
 * "Concluído" — cotação ainda precisa de ação (mandar pro cliente),
 * não é o mesmo que um serviço executado e fechado. Prioridade:
 * cancelado/falta > cotação > concluído > status normal do agendamento.
 *
 * Função pura, só de apresentação: nunca toca em `status` de verdade —
 * o botão "Concluir" continua disponível pro admin revisar e lançar o
 * financeiro quando quiser (ver handleComplete em calendar-view.tsx),
 * sem duplicar essa lógica de negócio aqui.
 */
export function effectiveDisplayStatus(appointment: {
  status: AppointmentStatus
  service_order_status: string
}): EffectiveDisplayStatus {
  if (appointment.status === 'cancelled' || appointment.status === 'no_show') return appointment.status
  if (appointment.service_order_status === 'quote') return 'quote'
  if (appointment.service_order_status === 'completed') return 'completed'
  return appointment.status
}
