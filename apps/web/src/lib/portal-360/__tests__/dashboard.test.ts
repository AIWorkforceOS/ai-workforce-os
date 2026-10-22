import { describe, expect, it } from 'vitest'
import type { ClientPortalOrder } from '../data'
import { countOrders, dayInZone, financeSummary, invoiceState, isClientVisibleInvoice, monthGrid, orderDay, ordersPerDay, stageOf, tabCounts, type PortalInvoice } from '../dashboard'

const NOW = new Date('2026-10-26T15:00:00Z')
const TZ = 'America/New_York'
const order = (over: Partial<ClientPortalOrder> = {}): ClientPortalOrder =>
  ({ id: 'o', status: 'scheduled', requestedDate: null, startsAt: '2026-10-20T14:00:00Z', timezone: TZ, quoteDecision: null, signedAt: null, updatedAt: '2026-10-20T14:00:00Z', ...over }) as ClientPortalOrder

describe('stageOf', () => {
  it('etapas simples', () => {
    expect(stageOf(order({ status: 'pending_assignment' }), NOW)).toBe('scheduling')
    expect(stageOf(order({ status: 'scheduled' }), NOW)).toBe('scheduled')
    expect(stageOf(order({ status: 'completed' }), NOW)).toBe('completed')
    expect(stageOf(order({ status: 'cancelled' }), NOW)).toBe('cancelled')
  })
  it('cotação: nova → Quote; depois de 1 dia sem decisão → Awaiting approval', () => {
    expect(stageOf(order({ status: 'quote', signedAt: '2026-10-26T10:00:00Z' }), NOW)).toBe('quote') // 5h
    expect(stageOf(order({ status: 'quote', signedAt: '2026-10-25T15:00:00Z' }), NOW)).toBe('awaiting_approval') // exatamente 24h
    expect(stageOf(order({ status: 'quote', signedAt: null, updatedAt: '2026-10-20T00:00:00Z' }), NOW)).toBe('awaiting_approval')
  })
  it('decisão do cliente move a ordem: aprovada → Scheduled; recusada → Completed', () => {
    expect(stageOf(order({ status: 'quote', quoteDecision: 'approved', signedAt: '2026-10-01T00:00:00Z' }), NOW)).toBe('approved')
    expect(stageOf(order({ status: 'quote', quoteDecision: 'rejected', signedAt: '2026-10-01T00:00:00Z' }), NOW)).toBe('declined')
  })
})

describe('dia e mês da ordem', () => {
  it('aguardando agendamento usa o dia pedido; as demais, o dia do atendimento no fuso da unidade', () => {
    expect(orderDay(order({ status: 'pending_assignment', requestedDate: '2026-11-03' }))).toBe('2026-11-03')
    expect(orderDay(order({ startsAt: '2026-10-21T02:30:00Z' }))).toBe('2026-10-20') // 22:30 em Nova York
    expect(dayInZone('2026-10-21', TZ)).toBe('2026-10-21')
  })
})

describe('countOrders / tabCounts / calendário', () => {
  const orders = [
    order({ id: '1', status: 'pending_assignment', requestedDate: '2026-10-28' }),
    order({ id: '2', status: 'scheduled', startsAt: '2026-10-27T14:00:00Z' }),
    order({ id: '3', status: 'completed', startsAt: '2026-10-05T14:00:00Z' }),
    order({ id: '4', status: 'quote', signedAt: '2026-10-26T12:00:00Z', startsAt: '2026-10-26T12:00:00Z' }),
    order({ id: '5', status: 'quote', signedAt: '2026-10-10T12:00:00Z', startsAt: '2026-10-10T12:00:00Z' }),
    order({ id: '6', status: 'quote', quoteDecision: 'approved', startsAt: '2026-10-11T12:00:00Z' }),
    order({ id: '7', status: 'cancelled', startsAt: '2026-10-12T12:00:00Z' }),
    order({ id: '8', status: 'completed', startsAt: '2026-09-15T12:00:00Z' }), // outro mês
  ]
  it('conta só o mês escolhido', () => {
    expect(countOrders(orders, '2026-10', NOW)).toEqual({ sent: 7, accepted: 5, scheduling: 1, scheduled: 2, quote: 1, awaiting: 1, completed: 1 })
    expect(countOrders(orders, '2026-09', NOW).sent).toBe(1)
    expect(countOrders(orders, '2026-08', NOW).sent).toBe(0)
  })
  it('abas: Scheduled / Completed / Quote / Awaiting', () => {
    expect(tabCounts(orders, '2026-10', NOW)).toEqual({ scheduled: 3, completed: 2, quote: 1, awaiting: 1 })
  })
  it('calendário', () => {
    const per = ordersPerDay(orders, '2026-10')
    expect(per.get('2026-10-28')).toBe(1)
    expect(per.get('2026-10-05')).toBe(1)
    expect(per.has('2026-09-15')).toBe(false)
    const grid = monthGrid('2026-10')
    expect(grid.every((w) => w.length === 7)).toBe(true)
    expect(grid[0]![4]).toBe('2026-10-01') // 1º de outubro de 2026 é quinta
    expect(grid.flat().filter(Boolean)).toHaveLength(31)
  })
})

describe('financeiro', () => {
  const inv = (over: Partial<PortalInvoice>): PortalInvoice => ({ id: 'i', invoiceNumber: 'INV-1', description: '', amount: 100, currency: 'USD', dueDate: '2026-10-30', status: 'sent', sentAt: null, paidAt: null, referenceMonth: '2026-10-01', ...over })
  it('só faturas emitidas aparecem para o cliente', () => {
    expect(['sent', 'paid'].every(isClientVisibleInvoice)).toBe(true)
    expect(['draft', 'cancelled', 'consolidated'].some(isClientVisibleInvoice)).toBe(false)
  })
  it('estado: paga, vencida ou a vencer', () => {
    expect(invoiceState(inv({ status: 'paid' }), '2026-11-30')).toBe('paid')
    expect(invoiceState(inv({ dueDate: '2026-10-20' }), '2026-10-26')).toBe('overdue')
    expect(invoiceState(inv({ dueDate: '2026-10-26' }), '2026-10-26')).toBe('pending')
    expect(invoiceState(inv({ dueDate: null }), '2026-10-26')).toBe('pending')
  })
  it('totais do mês e do geral', () => {
    const list = [inv({ id: '1', amount: 100 }), inv({ id: '2', amount: 250.5, status: 'paid', paidAt: '2026-10-10' }), inv({ id: '3', amount: 40, dueDate: '2026-09-01', referenceMonth: '2026-09-01' }), inv({ id: '4', amount: 60, dueDate: '2026-10-01' })]
    const s = financeSummary(list, '2026-10', '2026-10-26')
    expect(s.month).toEqual({ invoiced: 410.5, paid: 250.5, outstanding: 160, overdue: 60, count: 3 })
    expect(s.allOutstanding).toBe(200) // 100 + 40 + 60
    expect(s.allOverdue).toBe(100) // 40 (set) + 60 (out)
  })
})
