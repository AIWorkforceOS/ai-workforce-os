import type { ConversationChannel, ConversationDirection, ConversationStatus } from '@/lib/types'

/** Histórico de conversa por cliente (tabela customer_messages, migration 038) — espelha CandidateMessage (lib/recruiter/types.ts). */
export type CustomerMessage = {
  id: string
  customer_id: string
  unit_id: string
  channel: ConversationChannel
  direction: ConversationDirection
  content: string
  template_key: string | null
  external_message_id: string | null
  status: ConversationStatus
  sent_at: string
  created_at: string
}

/** Agendamento futuro do cliente, já com o nome do serviço resolvido — usado pelo motor de conversa (lib/receptionist/engine.ts) para confirmar/remarcar/cancelar sem outra ida ao banco. */
export type UpcomingAppointment = {
  id: string
  starts_at: string
  ends_at: string
  service_id: string | null
  service_name: string | null
  employee_id: string | null
  address: string | null
}
