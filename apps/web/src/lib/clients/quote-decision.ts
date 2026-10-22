import { z } from 'zod'

export const QUOTE_DECISIONS = ['approved', 'rejected'] as const
export type QuoteDecision = (typeof QUOTE_DECISIONS)[number]

export const quoteDecisionSchema = z.object({
  decision: z.enum(['approved', 'rejected', 'pending']),
  note: z.string().trim().max(500).optional(),
})

/** Monta o que gravar na ordem: 'pending' desfaz a decisão (volta a aguardar). Só vale para ordem em status Cotação. */
export function decisionPatch(
  decision: QuoteDecision | 'pending',
  note: string | undefined,
  userId: string,
  now: Date = new Date(),
) {
  if (decision === 'pending') return { quote_decision: null, quote_decided_at: null, quote_decided_by: null, quote_decision_note: null }
  return { quote_decision: decision, quote_decided_at: now.toISOString(), quote_decided_by: userId, quote_decision_note: note?.trim() ? note.trim() : null }
}
