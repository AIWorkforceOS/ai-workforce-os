import { describe, expect, it } from 'vitest'
import { isInvoiceOverdue } from '@/lib/invoice-status'

describe('isInvoiceOverdue', () => {
  const today = '2026-08-04'

  it('fatura enviada com vencimento passado está atrasada', () => {
    expect(isInvoiceOverdue({ status: 'sent', due_date: '2026-08-01' }, today)).toBe(true)
  })

  it('rascunho com vencimento passado também está atrasado', () => {
    expect(isInvoiceOverdue({ status: 'draft', due_date: '2026-07-15' }, today)).toBe(true)
  })

  it('vencimento hoje ainda não é atrasado', () => {
    expect(isInvoiceOverdue({ status: 'sent', due_date: today }, today)).toBe(false)
  })

  it('vencimento futuro não é atrasado', () => {
    expect(isInvoiceOverdue({ status: 'sent', due_date: '2026-08-20' }, today)).toBe(false)
  })

  it('sem vencimento nunca é atrasado', () => {
    expect(isInvoiceOverdue({ status: 'sent', due_date: null }, today)).toBe(false)
    expect(isInvoiceOverdue({ status: 'draft', due_date: null }, today)).toBe(false)
  })

  it('fatura paga, cancelada ou consolidada nunca aparece como atrasada', () => {
    expect(isInvoiceOverdue({ status: 'paid', due_date: '2026-01-01' }, today)).toBe(false)
    expect(isInvoiceOverdue({ status: 'cancelled', due_date: '2026-01-01' }, today)).toBe(false)
    expect(isInvoiceOverdue({ status: 'consolidated', due_date: '2026-01-01' }, today)).toBe(false)
  })
})
