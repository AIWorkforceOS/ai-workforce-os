export type ActivityKind = 'note' | 'call' | 'message' | 'followup' | 'task' | 'status_change'

export type LeadActivity = {
  id: string
  lead_id: string
  kind: ActivityKind
  body: string | null
  due_at: string | null
  done_at: string | null
  assigned_to: string | null
  created_by: string | null
  created_at: string
}

export const ACTIVITY_LABEL: Record<ActivityKind, string> = {
  note: 'Nota',
  call: 'Ligação',
  message: 'Mensagem',
  followup: 'Retorno',
  task: 'Tarefa',
  status_change: 'Etapa',
}

export type DueBucket = 'overdue' | 'today' | 'upcoming'

/** Dia (YYYY-MM-DD) de um instante no fuso informado. */
export function dayInZone(iso: string | Date, timeZone: string): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

/** Atrasado = o dia do prazo já passou; hoje = prazo no dia de hoje (mesmo que a hora ainda não chegou); depois = futuro. */
export function dueBucket(dueAt: string, now: Date, timeZone: string): DueBucket {
  const due = dayInZone(dueAt, timeZone)
  const today = dayInZone(now, timeZone)
  if (due < today) return 'overdue'
  if (due === today) return 'today'
  return 'upcoming'
}

export type OpenItem = Pick<LeadActivity, 'id' | 'lead_id' | 'kind' | 'due_at' | 'done_at'>

/** Retornos/tarefas em aberto (kind followup/task, sem done_at e com prazo). */
export function openItems<T extends OpenItem>(items: T[]): T[] {
  return items.filter((i) => (i.kind === 'followup' || i.kind === 'task') && !i.done_at && i.due_at)
}

/** Por lead: o próximo prazo em aberto e em que faixa ele está. */
export function nextDueByLead(items: OpenItem[], now: Date, timeZone: string): Map<string, { dueAt: string; bucket: DueBucket }> {
  const out = new Map<string, { dueAt: string; bucket: DueBucket }>()
  for (const i of openItems(items).sort((a, b) => a.due_at!.localeCompare(b.due_at!))) {
    if (!out.has(i.lead_id)) out.set(i.lead_id, { dueAt: i.due_at!, bucket: dueBucket(i.due_at!, now, timeZone) })
  }
  return out
}

export function dueCounts(next: Map<string, { bucket: DueBucket }>): { overdue: number; today: number } {
  let overdue = 0
  let today = 0
  for (const v of next.values()) {
    if (v.bucket === 'overdue') overdue += 1
    else if (v.bucket === 'today') today += 1
  }
  return { overdue, today }
}

export function validateNewActivity(input: { kind: ActivityKind; body: string; dueAt: string }): string | null {
  if ((input.kind === 'followup' || input.kind === 'task') && !input.dueAt) return 'Informe a data do retorno.'
  if ((input.kind === 'note' || input.kind === 'call' || input.kind === 'message') && !input.body.trim()) return 'Escreva o que aconteceu.'
  if (input.body.length > 2000) return 'Texto longo demais (máximo 2000 caracteres).'
  return null
}
