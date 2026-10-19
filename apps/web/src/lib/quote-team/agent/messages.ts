import type { SupabaseClient } from '@supabase/supabase-js'
import type { PendingItem } from '../contracts'

export type QuoteMessageRow = {
  id: string
  org_id: string
  unit_id: string
  appointment_id: string
  job_id: string | null
  draft_id: string | null
  role: 'agent' | 'technician' | 'admin' | 'system'
  kind: 'question' | 'answer' | 'revision_request' | 'note' | 'status'
  body: string | null
  media: { url: string; kind?: string; uploaded_at?: string }[]
  questions: { id: string; kind: string; request_pt: string }[]
  answers_to: string | null
  round: number
  created_by: string | null
  created_at: string
}

export type NewQuoteMessage = Pick<QuoteMessageRow, 'org_id' | 'unit_id' | 'appointment_id' | 'job_id' | 'role' | 'kind'> & Partial<Pick<QuoteMessageRow, 'draft_id' | 'body' | 'media' | 'questions' | 'answers_to' | 'round' | 'created_by'>>

export async function listQuoteMessages(db: SupabaseClient, appointmentId: string): Promise<QuoteMessageRow[]> {
  const { data } = await db.from('quote_messages').select('*').eq('appointment_id', appointmentId).order('created_at', { ascending: true })
  return (data as QuoteMessageRow[] | null) ?? []
}

export async function addQuoteMessage(db: SupabaseClient, message: NewQuoteMessage): Promise<QuoteMessageRow> {
  const { data, error } = await db
    .from('quote_messages')
    .insert({ draft_id: null, body: null, media: [], questions: [], answers_to: null, round: 1, created_by: null, ...message })
    .select('*')
    .single()
  if (error || !data) throw new Error(error?.message ?? 'Não foi possível registrar a mensagem.')
  return data as QuoteMessageRow
}

/** Pedidos de informação (codes `need_*`) viram UMA mensagem do agente, agrupada, em linguagem de campo. */
export function questionMessageFromPending(pending: PendingItem[]): { body: string; questions: QuoteMessageRow['questions'] } | null {
  const needs = pending.filter((p) => p.code.startsWith('need_'))
  if (needs.length === 0) return null
  const seen = new Set<string>()
  const questions: QuoteMessageRow['questions'] = []
  for (const p of needs) {
    const key = p.message_pt.trim().toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    questions.push({ id: `q${questions.length + 1}`, kind: p.code.replace(/^need_/, ''), request_pt: p.message_pt.trim() })
  }
  const body = questions.length === 1 ? `Preciso de uma informação para continuar: ${questions[0]!.request_pt}` : `Preciso de algumas informações para continuar:\n${questions.map((q) => `• ${q.request_pt}`).join('\n')}`
  return { body, questions }
}

/** Visão da mensagem para o TÉCNICO (lista permitida; nenhum campo interno). */
export function toTechnicianMessage(m: QuoteMessageRow) {
  return { id: m.id, role: m.role, kind: m.kind, body: m.body, media: m.media, questions: m.questions, round: m.round, created_at: m.created_at }
}
