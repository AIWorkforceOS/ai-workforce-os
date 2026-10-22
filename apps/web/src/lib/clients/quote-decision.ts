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

/** Regra da decisão feita pelo PRÓPRIO cliente no portal: só ordem em Cotação, com algo para aprovar, e uma única vez (desfazer é do administrador). */
export function clientDecisionBlock(order: { status: string | null; decision: string | null; quoteDescriptionEn: string | null; materialDescription: string | null }): string | null {
  if (order.status !== 'quote') return 'This order is not waiting for a quote decision.'
  if (order.decision === 'approved' || order.decision === 'rejected') return 'A decision was already recorded for this quote. Contact the office to change it.'
  if (!order.quoteDescriptionEn?.trim() && !order.materialDescription?.trim()) return 'There is no quote to approve yet.'
  return null
}
