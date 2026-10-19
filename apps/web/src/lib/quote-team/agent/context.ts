import type { Diagnosis } from '../contracts'
import type { PhotoPolicy } from '../jobs'

/** Um turno da conversa técnico ↔ agente (vai para os prompts; fotos entram em media_urls do job). */
export type ConversationTurn = {
  role: 'technician' | 'agent' | 'admin'
  kind: 'question' | 'answer' | 'revision_request' | 'note'
  body: string
  at: string
  media_count: number
}

/** Conteúdo de job.input_snapshot na jornada do piloto. NUNCA guarda valores comerciais. */
export type AgentSnapshot = {
  notes?: string
  media_urls?: string[]
  photo_policy?: PhotoPolicy
  conversation?: ConversationTurn[]
  /** O técnico escolheu "continuar sem essas informações": o agente não bloqueia mais a análise pedindo dados. */
  no_more_questions?: boolean
}

export const normalizeText = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '')

export function diagnosisFromSteps(stepResults: Record<string, unknown>): Diagnosis | null {
  const d = (stepResults.diagnosis as { diagnosis?: Diagnosis } | undefined)?.diagnosis
  return d ?? null
}

/** Texto em que marca/modelo/part number PODEM aparecer: etiquetas lidas, campos identificados, nota do técnico e conversa. */
export function groundingCorpus(snapshot: AgentSnapshot, diagnosis: Diagnosis | null): string {
  const parts: string[] = [snapshot.notes ?? '']
  for (const turn of snapshot.conversation ?? []) if (turn.role === 'technician') parts.push(turn.body)
  if (diagnosis) {
    parts.push(...diagnosis.identified.labels_read, ...diagnosis.identified.part_numbers)
    if (diagnosis.identified.brand) parts.push(diagnosis.identified.brand)
    if (diagnosis.identified.model) parts.push(diagnosis.identified.model)
  }
  return normalizeText(parts.join(' '))
}

/** Identificador (marca/modelo/part number) só vale se aparece no texto das evidências — nunca inventado pelo modelo. */
export function isGrounded(value: string | null | undefined, corpus: string): boolean {
  if (!value) return false
  const n = normalizeText(value)
  return n.length >= 3 && corpus.includes(n)
}

export function formatConversation(turns: ConversationTurn[] | undefined): string {
  if (!turns || turns.length === 0) return '(no conversation yet)'
  return turns
    .map((t) => `[${t.role}${t.kind === 'revision_request' ? ' — revision request' : t.kind === 'question' ? ' — question' : ''}${t.media_count > 0 ? `, +${t.media_count} photo(s)` : ''}] ${t.body}`)
    .join('\n')
}
