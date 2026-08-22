import type { SystemEvent } from '@/lib/system-events'

export type ActivityKind = 'handoff' | 'escalation' | 'human' | 'failure' | 'action'

export type ActivityItem = {
  id: string
  kind: ActivityKind
  label: string
  message: string
  createdAt: string
}

// Rótulos conhecidos pros event_type mais comuns hoje (handoffs, ações,
// intervenção humana) — o resto cai no fallback (prettifyEventType), que
// pelo menos não mostra um snake_case cru pro usuário. Não precisa ser uma
// lista exaustiva: cada novo tipo de evento sem entrada aqui ainda aparece
// de forma legível, só sem um rótulo customizado.
const KNOWN_LABELS: Record<string, string> = {
  human_operator_message: 'Atendimento assumido manualmente',
  human_intervention_released: 'Devolvido à automação',
  deal_won: 'Negócio fechado',
  'job.created': 'Vaga criada',
  'job.handed_off': 'Vaga encaminhada ao Recrutador',
  'job.escalated': 'Vaga escalada pra decisão humana',
  'shortlist.ready': 'Shortlist de candidatos pronta',
  'shortlist.presented': 'Shortlist apresentada',
  'candidate.contacted': 'Candidato contatado',
  'candidate.screened': 'Candidato triado',
  'candidate.selected': 'Candidato selecionado',
  appointment_confirmation: 'Agendamento confirmado',
  appointment_reschedule: 'Agendamento reagendado',
  appointment_cancellation: 'Agendamento cancelado',
  appointment_reminder: 'Lembrete de agendamento enviado',
  appointment_on_my_way: 'Aviso "a caminho" enviado',
  appointment_no_show: 'Falta registrada',
}

function prettifyEventType(eventType: string): string {
  return eventType
    .replace(/^receptionist_handoff_/, 'Encaminhado para ')
    .replace(/[._]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function classify(event: Pick<SystemEvent, 'event_type' | 'level'>): ActivityKind {
  if (event.event_type === 'human_operator_message' || event.event_type === 'human_intervention_released') return 'human'
  if (event.level === 'error' || event.event_type.endsWith('_failed')) return 'failure'
  if (event.event_type.startsWith('receptionist_handoff_') || event.event_type.includes('handed_off') || event.event_type.startsWith('sales_handoff_')) return 'handoff'
  if (event.event_type.includes('escalat')) return 'escalation'
  return 'action'
}

/** Converte as linhas cruas de system_events (já filtradas por contato) num formato pronto pra exibir na Caixa de Entrada. */
export function toActivityItems(events: SystemEvent[]): ActivityItem[] {
  return events.map((event) => ({
    id: event.id,
    kind: classify(event),
    label: KNOWN_LABELS[event.event_type] ?? prettifyEventType(event.event_type),
    message: event.message,
    createdAt: event.created_at,
  }))
}
