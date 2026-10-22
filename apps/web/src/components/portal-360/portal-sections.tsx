import Link from 'next/link'
import { Download, FileText } from 'lucide-react'
import { Badge, Card, EmptyState, type BadgeVariant } from '@/components/ui/dashboard-ui'
import type { ClientPortalOrder } from '@/lib/portal-360/data'
import { financeSummary, formatUsd, invoiceState, monthGrid, ordersPerDay, orderDay, stageOf, STAGE_LABEL, TAB_LABEL, TAB_OF_STAGE, TAB_ORDER, tabCounts, type OrderStage, type OrderTab, type PortalInvoice } from '@/lib/portal-360/dashboard'
import { monthLabel, shiftMonth } from '@/lib/service-operations-month'

const STAGE_VARIANT: Record<OrderStage, BadgeVariant> = { scheduling: 'amber', scheduled: 'blue', approved: 'green', completed: 'green', declined: 'red', cancelled: 'red', quote: 'purple', awaiting_approval: 'amber' }
const INVOICE_VARIANT = { paid: 'green', overdue: 'red', pending: 'amber' } as const
const INVOICE_LABEL = { paid: 'Paid', overdue: 'Overdue', pending: 'To be paid' } as const

export type PortalView = 'orders' | 'calendar' | 'financial'

export function dateLabel(iso: string | null): string {
  if (!iso) return '-'
  const d = iso.length === 10 ? new Date(`${iso}T00:00:00`) : new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })
}

export function href(params: { view?: PortalView; month?: string; tab?: OrderTab; day?: string }): string {
  const q = new URLSearchParams()
  if (params.view && params.view !== 'orders') q.set('view', params.view)
  if (params.month) q.set('month', params.month)
  if (params.tab && params.tab !== 'scheduled') q.set('tab', params.tab)
  if (params.day) q.set('day', params.day)
  const s = q.toString()
  return `/portal-360${s ? `?${s}` : ''}`
}

/** Seletor de mês: anterior / próximo / escolher qualquer um dos últimos 24 meses. */
export function MonthSwitcher({ month, currentMonth, view }: { month: string; currentMonth: string; view: PortalView }) {
  const options = Array.from({ length: 24 }, (_, i) => shiftMonth(currentMonth, 2 - i)) // 2 meses à frente (ordens futuras) + 21 para trás
  return (
    <div className="flex items-center gap-2">
      <Link href={href({ view, month: shiftMonth(month, -1) })} aria-label="Previous month" className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-300 hover:bg-white/5" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
        ‹
      </Link>
      <form method="get" className="flex items-center">
        {view !== 'orders' && <input type="hidden" name="view" value={view} />}
        <select name="month" defaultValue={month} aria-label="Month" className="rounded-xl bg-[#0b0f1a] px-3 py-2 text-sm font-bold text-white" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
          {options.map((m) => (
            <option key={m} value={m}>
              {monthLabel(m, 'en-US')}
            </option>
          ))}
        </select>
        <button type="submit" className="ml-2 rounded-xl px-3 py-2 text-xs font-bold text-slate-200 hover:bg-white/5" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
          Go
        </button>
      </form>
      <Link href={href({ view, month: shiftMonth(month, 1) })} aria-label="Next month" className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-300 hover:bg-white/5" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
        ›
      </Link>
    </div>
  )
}

export function ViewTabs({ view, month }: { view: PortalView; month: string }) {
  const items: { key: PortalView; label: string }[] = [
    { key: 'orders', label: 'Orders' },
    { key: 'calendar', label: 'Calendar' },
    { key: 'financial', label: 'Financial' },
  ]
  return (
    <div className="flex w-fit gap-1 rounded-xl p-1" style={{ background: 'rgba(255,255,255,0.04)' }}>
      {items.map((i) => (
        <Link key={i.key} href={href({ view: i.key, month })} className="rounded-lg px-4 py-2 text-xs font-bold transition-colors" style={view === i.key ? { background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)', color: 'white' } : { color: '#94a3b8' }}>
          {i.label}
        </Link>
      ))}
    </div>
  )
}

export function Kpi({ label, value, sub, tone = 'text-white' }: { label: string; value: string | number; sub?: string; tone?: string }) {
  return (
    <div className="rounded-2xl p-3 sm:p-4" style={{ background: '#141a2b', border: '1px solid rgba(255,255,255,0.06)' }}>
      <p className={`text-xl font-black sm:text-2xl ${tone}`}>{value}</p>
      <p className="mt-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
      {sub && <p className="mt-0.5 text-[11px] text-slate-500">{sub}</p>}
    </div>
  )
}

function OrderRow({ order, now }: { order: ClientPortalOrder; now: Date }) {
  const stage = stageOf(order, now)
  const day = orderDay(order)
  return (
    <Link href={`/portal-360/order/${order.id}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 transition-colors hover:bg-white/[0.03]" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-white">{order.orderNumber ? `#${order.orderNumber}` : 'Order'}</span>
          <Badge variant={STAGE_VARIANT[stage]}>{STAGE_LABEL[stage]}</Badge>
          {order.priority && <Badge variant="slate">{order.priority} priority</Badge>}
        </div>
        <p className="text-xs text-slate-400">
          {order.locationName ?? 'Location not specified'}
          {order.address ? ` · ${order.address}` : ''}
        </p>
        {(stage === 'quote' || stage === 'awaiting_approval') && order.materialValue != null && <p className="text-xs font-semibold text-purple-300">Quote: {formatUsd(order.materialValue)}</p>}
      </div>
      <span className="text-xs font-semibold text-slate-400">{stage === 'scheduling' ? `Requested for ${dateLabel(day)}` : dateLabel(day)}</span>
    </Link>
  )
}

export function OrdersSection({ orders, month, tab, now }: { orders: ClientPortalOrder[]; month: string; tab: OrderTab; now: Date }) {
  const counts = tabCounts(orders, month, now)
  const shown = orders
    .filter((o) => orderDay(o).slice(0, 7) === month && TAB_OF_STAGE[stageOf(o, now)] === tab)
    .sort((a, b) => orderDay(b).localeCompare(orderDay(a)))
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-1 rounded-xl p-1" style={{ background: 'rgba(255,255,255,0.04)' }}>
        {TAB_ORDER.map((t) => (
          <Link key={t} href={href({ view: 'orders', month, tab: t })} className="rounded-lg px-4 py-2 text-xs font-bold transition-colors" style={tab === t ? { background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)', color: 'white' } : { color: '#94a3b8' }}>
            {TAB_LABEL[t]} ({counts[t]})
          </Link>
        ))}
      </div>
      {shown.length === 0 ? (
        <Card>
          <EmptyState icon={<FileText size={22} className="text-white" />} title={`No ${TAB_LABEL[tab].toLowerCase()} orders in ${monthLabel(month, 'en-US')}`} subtitle="Pick another month, or attach a new order." actionHref="/portal-360/new" actionLabel="New order" />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="flex flex-col">
            {shown.map((o) => (
              <OrderRow key={o.id} order={o} now={now} />
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}

export function CalendarSection({ orders, month, day, today, now }: { orders: ClientPortalOrder[]; month: string; day: string | null; today: string; now: Date }) {
  const per = ordersPerDay(orders, month)
  const selected = day && day.slice(0, 7) === month ? day : today.slice(0, 7) === month ? today : `${month}-01`
  const dayOrders = orders.filter((o) => orderDay(o) === selected)
  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4">
        <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-bold uppercase tracking-wider text-slate-500">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
            <div key={d}>{d}</div>
          ))}
        </div>
        <div className="mt-1 flex flex-col gap-1">
          {monthGrid(month).map((week, wi) => (
            <div key={wi} className="grid grid-cols-7 gap-1">
              {week.map((d, di) =>
                d ? (
                  <Link
                    key={d}
                    href={href({ view: 'calendar', month, day: d })}
                    aria-label={`${dateLabel(d)}: ${per.get(d) ?? 0} orders`}
                    className="flex min-h-14 flex-col items-center justify-start rounded-lg p-1.5 text-xs font-semibold transition-colors hover:bg-white/5"
                    style={{ background: d === selected ? 'rgba(6,182,212,0.18)' : 'rgba(255,255,255,0.03)', border: d === today ? '1px solid rgba(6,182,212,0.6)' : '1px solid transparent', color: '#e2e8f0' }}
                  >
                    {Number(d.slice(8))}
                    {per.get(d) ? <span className="mt-1 rounded-full px-1.5 text-[10px] font-black text-white" style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)' }}>{per.get(d)}</span> : null}
                  </Link>
                ) : (
                  <div key={`e${wi}-${di}`} />
                ),
              )}
            </div>
          ))}
        </div>
      </Card>
      <div>
        <h2 className="mb-2 text-sm font-bold text-white">{dateLabel(selected)}</h2>
        {dayOrders.length === 0 ? (
          <p className="text-sm text-slate-400">No orders on this day.</p>
        ) : (
          <Card className="overflow-hidden">
            <div className="flex flex-col">
              {dayOrders.map((o) => (
                <OrderRow key={o.id} order={o} now={now} />
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}

export function FinancialSection({ invoices, month, today }: { invoices: PortalInvoice[]; month: string; today: string }) {
  const summary = financeSummary(invoices, month, today)
  const shown = invoices.filter((i) => i.referenceMonth.slice(0, 7) === month).sort((a, b) => (b.dueDate ?? '').localeCompare(a.dueDate ?? ''))
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Invoiced this month" value={formatUsd(summary.month.invoiced)} sub={`${summary.month.count} invoice(s)`} />
        <Kpi label="Paid" value={formatUsd(summary.month.paid)} tone="text-emerald-400" />
        <Kpi label="To be paid" value={formatUsd(summary.month.outstanding)} tone="text-amber-400" />
        <Kpi label="Overdue" value={formatUsd(summary.month.overdue)} tone={summary.month.overdue > 0 ? 'text-red-400' : 'text-white'} />
      </div>
      <p className="text-xs text-slate-400">
        All months: <span className="font-bold text-amber-300">{formatUsd(summary.allOutstanding)}</span> still to be paid
        {summary.allOverdue > 0 ? <>, of which <span className="font-bold text-red-400">{formatUsd(summary.allOverdue)}</span> is overdue</> : null}.
      </p>
      {shown.length === 0 ? (
        <Card>
          <EmptyState icon={<FileText size={22} className="text-white" />} title={`No invoices for ${monthLabel(month, 'en-US')}`} subtitle="Invoices appear here as soon as they are issued." />
        </Card>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                {['Invoice', 'Description', 'Amount', 'Due date', 'Status', 'Paid on', ''].map((h) => (
                  <th key={h} className="px-4 py-3">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((inv) => {
                const state = invoiceState(inv, today)
                return (
                  <tr key={inv.id} className="border-t" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
                    <td className="px-4 py-3 font-semibold text-white">{inv.invoiceNumber}</td>
                    <td className="max-w-[260px] truncate px-4 py-3 text-slate-300">{inv.description}</td>
                    <td className="px-4 py-3 font-semibold text-white">{formatUsd(inv.amount)}</td>
                    <td className="px-4 py-3 text-slate-300">{dateLabel(inv.dueDate)}</td>
                    <td className="px-4 py-3">
                      <Badge variant={INVOICE_VARIANT[state]}>{INVOICE_LABEL[state]}</Badge>
                    </td>
                    <td className="px-4 py-3 text-slate-300">{dateLabel(inv.paidAt)}</td>
                    <td className="px-4 py-3">
                      <a href={`/api/portal-360/invoices/${inv.id}/pdf`} className="inline-flex items-center gap-1 text-xs font-bold text-cyan-300 hover:text-cyan-200">
                        <Download size={13} />
                        PDF
                      </a>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}
