import { describe, expect, it } from 'vitest'
import { decisionPatch, quoteDecisionSchema } from '../quote-decision'

describe('decisionPatch', () => {
  it('grava decisão, quem decidiu e a nota', () => {
    const p = decisionPatch('approved', '  ok por e-mail ', 'u1', new Date('2026-10-23T12:00:00Z'))
    expect(p).toEqual({ quote_decision: 'approved', quote_decided_at: '2026-10-23T12:00:00.000Z', quote_decided_by: 'u1', quote_decision_note: 'ok por e-mail' })
  })
  it('pending limpa tudo; nota vazia vira null', () => {
    expect(decisionPatch('pending', 'x', 'u1')).toEqual({ quote_decision: null, quote_decided_at: null, quote_decided_by: null, quote_decision_note: null })
    expect(decisionPatch('rejected', '  ', 'u1').quote_decision_note).toBeNull()
  })
  it('valida o corpo', () => {
    expect(quoteDecisionSchema.safeParse({ decision: 'maybe' }).success).toBe(false)
    expect(quoteDecisionSchema.safeParse({ decision: 'rejected' }).success).toBe(true)
  })
})

import { clientDecisionBlock } from '../quote-decision'

describe('clientDecisionBlock', () => {
  const ok = { status: 'quote', decision: null, quoteDescriptionEn: 'Replace panel', materialDescription: null }
  it('libera ordem em cotação sem decisão e com conteúdo', () => {
    expect(clientDecisionBlock(ok)).toBeNull()
    expect(clientDecisionBlock({ ...ok, quoteDescriptionEn: null, materialDescription: 'painel' })).toBeNull()
  })
  it('bloqueia fora de cotação, já decidida ou vazia', () => {
    expect(clientDecisionBlock({ ...ok, status: 'completed' })).not.toBeNull()
    expect(clientDecisionBlock({ ...ok, decision: 'approved' })).not.toBeNull()
    expect(clientDecisionBlock({ ...ok, decision: 'rejected' })).not.toBeNull()
    expect(clientDecisionBlock({ ...ok, quoteDescriptionEn: ' ', materialDescription: null })).not.toBeNull()
    expect(clientDecisionBlock({ ...ok, quoteDescriptionEn: null, materialDescription: null, materialValue: 250 })).toBeNull() // só o valor do material já é cotação
  })
})
