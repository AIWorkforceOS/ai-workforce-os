import { Plus } from 'lucide-react'
import { getAppUser } from '@/lib/app-user'
import { createServiceClient } from '@/lib/supabase/service'
import { fetchClientInvoices, fetchClientOrders } from '@/lib/portal-360/data'
import { countOrders, financeSummary, formatUsd, TAB_ORDER, type OrderTab } from '@/lib/portal-360/dashboard'
import { currentMonthInTimezone, resolveSelectedMonth, todayInTimezone } from '@/lib/service-operations-month'
import { PageHeader, PrimaryButton } from '@/components/ui/dashboard-ui'
import { CalendarSection, FinancialSection, Kpi, MonthSwitcher, OrdersSection, ViewTabs, type PortalView } from '@/components/portal-360/portal-sections'

// force-dynamic: sem isso, anexar uma ordem nova e voltar pode mostrar dado desatualizado (Data Cache do Next).
export const dynamic = 'force-dynamic'

const DEFAULT_TZ = 'America/New_York'

/**
 * Painel do cliente (sempre em inglês): indicadores do mês, ordens por aba (Scheduled / Completed / Quote / Awaiting approval), calendário com as ordens de
 * cada dia e a aba Financial com as faturas. O mês é escolhido no topo e vale para tudo.
 */
export default async function Portal360Page({ searchParams }: { searchParams: Promise<{ view?: string; month?: string; tab?: string; day?: string }> }) {
  const appUser = await getAppUser()
  if (!appUser || appUser.role !== 'client' || !appUser.clientCompany) return null

  const sp = await searchParams
  const view: PortalView = sp.view === 'calendar' || sp.view === 'financial' ? sp.view : 'orders'
  const tab: OrderTab = (TAB_ORDER as string[]).includes(sp.tab ?? '') ? (sp.tab as OrderTab) : 'scheduled'

  const supabase = createServiceClient()
  const [orders, invoices] = supabase ? await Promise.all([fetchClientOrders(supabase, appUser.clientCompany), fetchClientInvoices(supabase, appUser.clientCompany)]) : [[], []]

  const tz = orders[0]?.timezone ?? DEFAULT_TZ
  const now = new Date()
  const today = todayInTimezone(tz)
  const currentMonth = currentMonthInTimezone(tz)
  const month = resolveSelectedMonth(sp.month, tz)
  const counts = countOrders(orders, month, now)
  const finance = financeSummary(invoices, month, today)

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Service orders"
        title="Dashboard"
        subtitle="All stores, all locations — track every order, quote and invoice in one place."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <MonthSwitcher month={month} currentMonth={currentMonth} view={view} />
            <PrimaryButton href="/portal-360/new" icon={<Plus size={14} />}>
              New order
            </PrimaryButton>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-5">
        <Kpi label="Orders sent" value={counts.sent} />
        <Kpi label="Accepted" value={counts.accepted} />
        <Kpi label="In scheduling" value={counts.scheduling} tone={counts.scheduling > 0 ? 'text-amber-300' : 'text-white'} />
        <Kpi label="Scheduled" value={counts.scheduled} tone="text-blue-300" />
        <Kpi label="Quotes" value={counts.quote} tone="text-purple-300" />
        <Kpi label="Awaiting approval" value={counts.awaiting} tone={counts.awaiting > 0 ? 'text-amber-300' : 'text-white'} />
        <Kpi label="Completed" value={counts.completed} tone="text-emerald-400" />
        <Kpi label="Invoices to be paid" value={formatUsd(finance.allOutstanding)} sub="all months" tone={finance.allOutstanding > 0 ? 'text-amber-300' : 'text-white'} />
        <Kpi label="Overdue" value={formatUsd(finance.allOverdue)} sub="all months" tone={finance.allOverdue > 0 ? 'text-red-400' : 'text-white'} />
        <Kpi label="Paid this month" value={formatUsd(finance.month.paid)} tone="text-emerald-400" />
      </div>

      <ViewTabs view={view} month={month} />

      {view === 'orders' && <OrdersSection orders={orders} month={month} tab={tab} now={now} />}
      {view === 'calendar' && <CalendarSection orders={orders} month={month} day={sp.day ?? null} today={today} now={now} />}
      {view === 'financial' && <FinancialSection invoices={invoices} month={month} today={today} />}
    </div>
  )
}
