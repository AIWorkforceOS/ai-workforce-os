import type { ClientPortalOrder } from './data'

/** Depois de quanto tempo uma cotação sem resposta passa de "Quote" para "Awaiting approval". */
export const AWAITING_APPROVAL_AFTER_MS = 24 * 60 * 60 * 1000

export type OrderStage = 'scheduling' | 'scheduled' | 'approved' | 'completed' | 'declined' | 'cancelled' | 'quote' | 'awaiting_approval'
export type OrderTab = 'scheduled' | 'completed' | 'quote' | 'awaiting'

export const STAGE_LABEL: Record<OrderStage, string> = {
  scheduling: 'Pending scheduling',
  scheduled: 'Scheduled',
  approved: 'Quote approved',
  completed: 'Completed',
  declined: 'Quote declined',
  cancelled: 'Cancelled',
  quote: 'Quote',
  awaiting_approval: 'Awaiting approval',
}

export const TAB_OF_STAGE: Record<OrderStage, OrderTab> = {
  scheduling: 'scheduled',
  scheduled: 'scheduled',
  approved: 'scheduled',
  completed: 'completed',
  declined: 'completed',
  cancelled: 'completed',
  quote: 'quote',
  awaiting_approval: 'awaiting',
}

export const TAB_LABEL: Record<OrderTab, string> = { scheduled: 'Scheduled', completed: 'Completed', quote: 'Quote', awaiting: 'Awaiting approval' }
export const TAB_ORDER: OrderTab[] = ['scheduled', 'completed', 'quote', 'awaiting']

type StageInput = Pick<ClientPortalOrder, 'status' | 'quoteDecision' | 'signedAt' | 'updatedAt'>

/**
 * Em que etapa a ordem está do ponto de vista do cliente. A cotação nasce em "Quote" e, passado 1 dia sem decisão, vai para
 * "Awaiting approval". Cotação aprovada volta para "Scheduled" (falta executar); recusada vai para "Completed" (encerrada).
 */
export function stageOf(order: StageInput, now: Date): OrderStage {
  switch (order.status) {
    case 'cancelled':
      return 'cancelled'
    case 'pending_assignment':
      return 'scheduling'
    case 'scheduled':
      return 'scheduled'
    case 'completed':
      return 'completed'
    case 'quote': {
      if (order.quoteDecision === 'approved') return 'approved'
      if (order.quoteDecision === 'rejected') return 'declined'
      const since = new Date(order.signedAt ?? order.updatedAt).getTime()
      return Number.isFinite(since) && now.getTime() - since >= AWAITING_APPROVAL_AFTER_MS ? 'awaiting_approval' : 'quote'
    }
  }
}

/** Dia (YYYY-MM-DD) de uma data/hora no fuso informado. */
export function dayInZone(iso: string, timeZone: string): string {
  if (iso.length === 10) return iso
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
}

/** Dia da ordem: o dia pedido enquanto aguarda agendamento; depois, o dia em que foi/será atendida. */
export function orderDay(order: Pick<ClientPortalOrder, 'status' | 'requestedDate' | 'startsAt' | 'timezone'>): string {
  return order.status === 'pending_assignment' && order.requestedDate ? order.requestedDate : dayInZone(order.startsAt, order.timezone)
}

export function inMonth(day: string, month: string): boolean {
  return day.slice(0, 7) === month
}

export type OrderCounts = { sent: number; accepted: number; scheduling: number; scheduled: number; quote: number; awaiting: number; completed: number }

/**
 * Indicadores do mês: enviadas (todas), aceitas (a Mawi já aceitou e agendou/atendeu — tudo que saiu de "aguardando agendamento", sem canceladas),
 * em agendamento, agendadas, cotação, aguardando aprovação e concluídas.
 */
export function countOrders(orders: ClientPortalOrder[], month: string, now: Date): OrderCounts {
  const c: OrderCounts = { sent: 0, accepted: 0, scheduling: 0, scheduled: 0, quote: 0, awaiting: 0, completed: 0 }
  for (const o of orders) {
    if (!inMonth(orderDay(o), month)) continue
    const stage = stageOf(o, now)
    c.sent += 1
    if (stage !== 'scheduling' && stage !== 'cancelled') c.accepted += 1
    if (stage === 'scheduling') c.scheduling += 1
    if (stage === 'scheduled' || stage === 'approved') c.scheduled += 1
    if (stage === 'quote') c.quote += 1
    if (stage === 'awaiting_approval') c.awaiting += 1
    if (stage === 'completed') c.completed += 1
  }
  return c
}

export function tabCounts(orders: ClientPortalOrder[], month: string, now: Date): Record<OrderTab, number> {
  const out: Record<OrderTab, number> = { scheduled: 0, completed: 0, quote: 0, awaiting: 0 }
  for (const o of orders) if (inMonth(orderDay(o), month)) out[TAB_OF_STAGE[stageOf(o, now)]] += 1
  return out
}

/** Contagem de ordens por dia do mês, para o calendário. */
export function ordersPerDay(orders: ClientPortalOrder[], month: string): Map<string, number> {
  const m = new Map<string, number>()
  for (const o of orders) {
    const day = orderDay(o)
    if (inMonth(day, month)) m.set(day, (m.get(day) ?? 0) + 1)
  }
  return m
}

/** Grade do mês: semanas começando no domingo, com null nos dias de fora do mês. */
export function monthGrid(month: string): (string | null)[][] {
  const [y = 0, m = 1] = month.split('-').map(Number)
  const first = new Date(Date.UTC(y, m - 1, 1))
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const cells: (string | null)[] = Array.from({ length: first.getUTCDay() }, () => null)
  for (let d = 1; d <= daysInMonth; d += 1) cells.push(`${month}-${String(d).padStart(2, '0')}`)
  while (cells.length % 7 !== 0) cells.push(null)
  const weeks: (string | null)[][] = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  return weeks
}

// ── Financeiro ──────────────────────────────────────────────────────────────

export type PortalInvoice = { id: string; invoiceNumber: string; description: string; amount: number; currency: string; dueDate: string | null; status: string; sentAt: string | null; paidAt: string | null; referenceMonth: string }
export type InvoiceState = 'paid' | 'overdue' | 'pending'

/** O cliente só enxerga faturas já emitidas: enviadas (a pagar) e pagas. Rascunho, cancelada e consolidada (substituída por outra) ficam de fora. */
export function isClientVisibleInvoice(status: string): boolean {
  return status === 'sent' || status === 'paid'
}

export function invoiceState(inv: Pick<PortalInvoice, 'status' | 'dueDate'>, today: string): InvoiceState {
  if (inv.status === 'paid') return 'paid'
  return inv.dueDate && inv.dueDate < today ? 'overdue' : 'pending'
}

export type FinanceSummary = { invoiced: number; paid: number; outstanding: number; overdue: number; count: number }

/** Totais do mês escolhido (pelo mês de referência da fatura) + o que está em aberto no geral (a pagar e vencido de qualquer mês). */
export function financeSummary(invoices: PortalInvoice[], month: string, today: string): { month: FinanceSummary; allOutstanding: number; allOverdue: number } {
  const monthSum: FinanceSummary = { invoiced: 0, paid: 0, outstanding: 0, overdue: 0, count: 0 }
  let allOutstanding = 0
  let allOverdue = 0
  for (const inv of invoices) {
    const state = invoiceState(inv, today)
    if (state !== 'paid') {
      allOutstanding += inv.amount
      if (state === 'overdue') allOverdue += inv.amount
    }
    if (inv.referenceMonth.slice(0, 7) !== month) continue
    monthSum.count += 1
    monthSum.invoiced += inv.amount
    if (state === 'paid') monthSum.paid += inv.amount
    else {
      monthSum.outstanding += inv.amount
      if (state === 'overdue') monthSum.overdue += inv.amount
    }
  }
  const r = (n: number) => Math.round(n * 100) / 100
  return { month: { invoiced: r(monthSum.invoiced), paid: r(monthSum.paid), outstanding: r(monthSum.outstanding), overdue: r(monthSum.overdue), count: monthSum.count }, allOutstanding: r(allOutstanding), allOverdue: r(allOverdue) }
}

export function formatUsd(value: number): string {
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}
