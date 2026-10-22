import { notFound } from 'next/navigation'
import { CalendarSection, FinancialSection, Kpi, MonthSwitcher, OrdersSection, ViewTabs, type PortalView } from '@/components/portal-360/portal-sections'
import { ClientQuoteView } from '@/components/portal-360/client-quote-view'
import { countOrders, financeSummary, formatUsd, TAB_ORDER, type OrderTab, type PortalInvoice } from '@/lib/portal-360/dashboard'
import type { ClientPortalOrder } from '@/lib/portal-360/data'

/** Pré-visualização SOMENTE DE DESENVOLVIMENTO do painel do cliente (dados de exemplo, nenhum banco). Em produção responde 404. */
const NOW = new Date('2026-10-26T15:00:00Z')
const o = (over: Partial<ClientPortalOrder>): ClientPortalOrder =>
  ({ id: Math.random().toString(36).slice(2), unitId: 'u', timezone: 'America/New_York', customerName: 'ACME', status: 'scheduled', requestedDate: null, startsAt: '2026-10-27T14:00:00Z', endsAt: '2026-10-27T15:00:00Z', address: '123 Main St, Miami, FL', orderNumber: '160936-01', locationName: 'Store #12', scopeEn: null, fileUrl: null, fileName: null, signedBy: null, signedAt: null, signatureUrl: null, photos: [], createdAt: '2026-10-20T10:00:00Z', materialDescription: null, materialValue: null, hoursNeeded: null, partPurchaseLink: null, quoteDescriptionEn: null, quoteDescriptionPt: null, quoteDecision: null, quoteDecidedAt: null, priority: 'Medium', clientRequest: null, quoteItems: [], updatedAt: '2026-10-20T10:00:00Z', ...over }) as ClientPortalOrder
const orders = [
  o({ status: 'pending_assignment', requestedDate: '2026-10-29', orderNumber: '161001-01', priority: 'High' }),
  o({ startsAt: '2026-10-27T14:00:00Z', orderNumber: '160936-02', locationName: 'Store #3' }),
  o({ startsAt: '2026-10-27T18:00:00Z', orderNumber: '160936-03', locationName: 'Store #8' }),
  o({ status: 'completed', startsAt: '2026-10-08T14:00:00Z', orderNumber: '159636-01', signedAt: '2026-10-08T16:00:00Z' }),
  o({ status: 'completed', startsAt: '2026-10-15T14:00:00Z', orderNumber: '159700-01', signedAt: '2026-10-15T16:00:00Z' }),
  o({ status: 'quote', startsAt: '2026-10-26T12:00:00Z', signedAt: '2026-10-26T12:00:00Z', orderNumber: '161200-01', materialValue: 1840.5 }),
  o({ status: 'quote', startsAt: '2026-10-22T12:00:00Z', signedAt: '2026-10-22T12:00:00Z', orderNumber: '161111-01', materialValue: 620 }),
  o({ status: 'quote', quoteDecision: 'approved', startsAt: '2026-10-19T12:00:00Z', signedAt: '2026-10-19T12:00:00Z', orderNumber: '160500-01' }),
]
const inv = (over: Partial<PortalInvoice>): PortalInvoice => ({ id: Math.random().toString(36).slice(2), invoiceNumber: 'INV-0001', description: '3 order(s) — ACME', amount: 540, currency: 'USD', dueDate: '2026-10-30', status: 'sent', sentAt: '2026-10-15', paidAt: null, referenceMonth: '2026-10-01', ...over })
const invoices = [inv({ invoiceNumber: 'INV-0009', amount: 540, dueDate: '2026-11-05' }), inv({ invoiceNumber: 'INV-0008', amount: 1210.75, status: 'paid', paidAt: '2026-10-12', dueDate: '2026-10-14' }), inv({ invoiceNumber: 'INV-0007', amount: 320, dueDate: '2026-10-20' }), inv({ invoiceNumber: 'INV-0005', amount: 90, referenceMonth: '2026-09-01', dueDate: '2026-09-25' })]

export default async function PortalPreviewPage({ searchParams }: { searchParams: Promise<{ view?: string; tab?: string; day?: string }> }) {
  if (process.env.NODE_ENV === 'production') notFound()
  const sp = await searchParams
  const view: PortalView = sp.view === 'calendar' || sp.view === 'financial' ? sp.view : 'orders'
  const tab: OrderTab = (TAB_ORDER as string[]).includes(sp.tab ?? '') ? (sp.tab as OrderTab) : 'scheduled'
  const month = '2026-10'
  const counts = countOrders(orders, month, NOW)
  const finance = financeSummary(invoices, month, '2026-10-26')
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 p-4" style={{ background: '#0a0f1e', minHeight: '100vh' }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-black text-white">Dashboard</h1>
        <MonthSwitcher month={month} currentMonth={month} view={view} />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-5">
        <Kpi label="Orders sent" value={counts.sent} />
        <Kpi label="Accepted" value={counts.accepted} />
        <Kpi label="In scheduling" value={counts.scheduling} tone="text-amber-300" />
        <Kpi label="Scheduled" value={counts.scheduled} tone="text-blue-300" />
        <Kpi label="Quotes" value={counts.quote} tone="text-purple-300" />
        <Kpi label="Awaiting approval" value={counts.awaiting} tone="text-amber-300" />
        <Kpi label="Completed" value={counts.completed} tone="text-emerald-400" />
        <Kpi label="Invoices to be paid" value={formatUsd(finance.allOutstanding)} sub="all months" tone="text-amber-300" />
        <Kpi label="Overdue" value={formatUsd(finance.allOverdue)} sub="all months" tone="text-red-400" />
        <Kpi label="Paid this month" value={formatUsd(finance.month.paid)} tone="text-emerald-400" />
      </div>
      <ViewTabs view={view} month={month} />
      {view === 'orders' && <OrdersSection orders={orders} month={month} tab={tab} now={NOW} />}
      {view === 'calendar' && <CalendarSection orders={orders} month={month} day={sp.day ?? null} today="2026-10-26" now={NOW} />}
      {view === 'financial' && <FinancialSection invoices={invoices} month={month} today="2026-10-26" />}
      <ClientQuoteView
        appointmentId="x"
        description="Replace two LED exit signs and the damaged door closer at the rear entrance."
        items={[{ description: 'LED exit sign, red', quantity: 2, unitPrice: 89.5 }, { description: 'Door closer, heavy duty', quantity: 1, unitPrice: 145 }]}
        materialValue={324}
        hoursNeeded={6}
        partLink="https://example.com/part"
        approvedAmount={250}
        approvedHours={4}
        decision={null}
        decidedAt={null}
        stageLabel="Quote"
      />
    </div>
  )
}
