import { ChevronLeft, TrendingUp, Wallet, Wallet2 } from 'lucide-react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getAppUser } from '@/lib/app-user'
import { fetchEmployeePortalData, fetchEmployeeUnitContext, PORTAL_DATA_SINCE } from '@/lib/portal-funcionario/data'
import { summarizeEmployeeServiceRecords } from '@/lib/portal-funcionario/financials'
import { AgendaSection } from '@/components/portal-funcionario/agenda-section'
import { Badge, Card, CardHeader, EmptyState, KpiCard, PageHeader, type BadgeVariant } from '@/components/ui/dashboard-ui'
import {
  currentMonthInTimezone,
  monthLabel,
  monthRange,
  resolveMonthSelection,
  shiftMonth,
} from '@/lib/service-operations-month'

const PAYMENT_STATUS_LABEL: Record<string, string> = {
  pending: 'Pendente',
  partial: 'Pago parcial',
  paid: 'Pago',
}

const PAYMENT_STATUS_VARIANT: Record<string, BadgeVariant> = {
  pending: 'amber',
  partial: 'blue',
  paid: 'green',
}

function formatDate(iso: string, locale: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(locale, { dateStyle: 'short' })
}

function formatCurrency(value: number, locale: string, currency: string): string {
  return value.toLocaleString(locale, { style: 'currency', currency })
}

// force-dynamic: mesmo motivo da tela de Operação da unidade (ver
// apps/web/src/app/dashboard/units/[id]/operacao/page.tsx) — sem isso,
// os fetch() do supabase-js caem no Data Cache do Next e o financeiro
// do funcionário pode mostrar dado desatualizado depois de um lançamento.
export const dynamic = 'force-dynamic'

export default async function PortalFuncionarioPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>
}) {
  const appUser = await getAppUser()

  // Guarda já é aplicada no layout, mas sem employeeId não há o que buscar.
  if (!appUser || appUser.role !== 'employee' || !appUser.employeeId) {
    redirect('/login')
  }

  const { month: monthParam } = await searchParams
  const supabase = await createClient()
  const [{ appointments, serviceRecords }, { timezone, locale: unitLocale }] = await Promise.all([
    fetchEmployeePortalData(supabase, appUser.employeeId),
    fetchEmployeeUnitContext(supabase, appUser.employeeId),
  ])

  const locale = unitLocale === 'en' ? 'en-US' : 'pt-BR'
  const currency = unitLocale === 'en' ? 'USD' : 'BRL'
  const currentMonth = currentMonthInTimezone(timezone)
  const monthSelection = resolveMonthSelection(monthParam, timezone)
  const isAllMonths = monthSelection === 'all'
  const selectedMonth = isAllMonths ? currentMonth : monthSelection
  const isCurrentMonth = selectedMonth === currentMonth
  const selectedMonthLabel = monthLabel(selectedMonth, locale)

  // <input type="month"> tem suporte inconsistente entre navegadores — um
  // <select> com valores fixos (mesmo padrão da tela de Operação) evita
  // que o navegador sirva um valor que resolveMonthSelection() não
  // reconheça e caia silenciosamente no mês atual.
  const monthOptions = Array.from({ length: 26 }, (_, i) => shiftMonth(currentMonth, 1 - i))

  const visibleServiceRecords = isAllMonths
    ? serviceRecords
    : (() => {
        const { start, nextStart } = monthRange(selectedMonth)
        return serviceRecords.filter((r) => r.service_date >= start && r.service_date < nextStart)
      })()

  const summary = summarizeEmployeeServiceRecords(visibleServiceRecords)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="portal do funcionário"
        title={`Olá, ${appUser.name?.split(' ')[0] ?? 'funcionário'}`}
        subtitle={`Sua agenda e seus valores lançados a partir de ${formatDate(PORTAL_DATA_SINCE, locale)}.`}
      />

      <Card className="overflow-hidden">
        <AgendaSection appointments={appointments} timezone={timezone} locale={locale} />
      </Card>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 p-5">
          <CardHeader eyebrow="financeiro" title="Seu demonstrativo financeiro" />
          <form method="get" className="flex items-center gap-1.5">
            {isAllMonths ? (
              <span
                className="rounded-xl px-3 py-2 text-xs font-bold text-cyan-300"
                style={{ border: '1px solid rgba(6,182,212,0.3)', background: 'rgba(6,182,212,0.08)' }}
              >
                Todos os meses
              </span>
            ) : (
              <>
                {/* <a> puro, não <Link>: força reload completo do servidor a
                    cada troca de mês, sem depender do Router Cache/prefetch
                    do App Router (mesmo cuidado da tela de Operação, que já
                    teve bugs de cache nessa mesma decisão). */}
                <a
                  href={`?month=${shiftMonth(selectedMonth, -1)}`}
                  className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-300 transition-all hover:bg-white/5"
                  style={{ border: '1px solid rgba(255,255,255,0.08)' }}
                  aria-label="Mês anterior"
                >
                  <ChevronLeft size={14} />
                </a>
                <select
                  name="month"
                  defaultValue={selectedMonth}
                  className="rounded-xl bg-[#0b0f1a] px-3 py-2 text-xs font-bold text-white"
                  style={{ border: '1px solid rgba(255,255,255,0.08)' }}
                >
                  {monthOptions.map((m) => (
                    <option key={m} value={m}>
                      {monthLabel(m, locale)}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  className="rounded-xl px-3 py-2 text-xs font-bold text-white transition-all hover:scale-[1.02] active:scale-[0.98]"
                  style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)' }}
                >
                  Ir
                </button>
                {!isCurrentMonth && (
                  <a
                    href="?"
                    className="rounded-xl px-3 py-2 text-xs font-bold text-cyan-300 transition-all hover:bg-white/5"
                    style={{ border: '1px solid rgba(255,255,255,0.08)' }}
                  >
                    Mês atual
                  </a>
                )}
              </>
            )}
            <a
              href={isAllMonths ? `?month=${currentMonth}` : '?month=all'}
              className="rounded-xl px-3 py-2 text-xs font-bold text-cyan-300 transition-all hover:bg-white/5"
              style={{ border: '1px solid rgba(255,255,255,0.08)' }}
            >
              {isAllMonths ? 'Ver mês a mês' : 'Todos os meses'}
            </a>
          </form>
        </div>

        <div className="px-5 pb-2">
          <div
            className="flex flex-wrap items-center gap-2.5 rounded-2xl p-3"
            style={{ background: 'rgba(6,182,212,0.08)', border: '1px solid rgba(6,182,212,0.25)' }}
          >
            <span className="text-[10px] font-black uppercase tracking-[0.15em] text-cyan-300">Demonstrativo de</span>
            <span className="text-sm font-black capitalize text-white">
              {isAllMonths ? 'Todo o histórico' : selectedMonthLabel}
            </span>
            {!isAllMonths && isCurrentMonth && (
              <span className="rounded-full px-2 py-0.5 text-[10px] font-bold text-cyan-300" style={{ background: 'rgba(6,182,212,0.15)' }}>
                mês atual
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 px-5 pb-5 pt-3 sm:grid-cols-3">
          <KpiCard
            label="Lançado no mês"
            value={formatCurrency(summary.totalDue, locale, currency)}
            sub={`${summary.recordCount} lançamento${summary.recordCount === 1 ? '' : 's'}`}
            icon={<Wallet size={16} className="text-white" />}
            gradient="from-cyan-400 to-blue-500"
          />
          <KpiCard
            label="Recebido"
            value={formatCurrency(summary.totalPaid, locale, currency)}
            sub="já pago a você"
            icon={<Wallet2 size={16} className="text-white" />}
            gradient="from-emerald-400 to-green-500"
          />
          <KpiCard
            label="Falta receber"
            value={formatCurrency(summary.totalRemaining, locale, currency)}
            sub="ainda pendente"
            icon={<TrendingUp size={16} className="text-white" />}
            gradient="from-amber-400 to-orange-500"
          />
        </div>

        {visibleServiceRecords.length === 0 ? (
          <EmptyState
            icon={<Wallet size={22} className="text-white" />}
            title="Nenhum lançamento neste recorte"
            subtitle="Quando a unidade lançar um serviço executado por você neste período, o valor aparece aqui."
          />
        ) : (
          <div className="flex flex-col divide-y" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
            {visibleServiceRecords.map((rec) => (
              <div key={rec.id} className="flex flex-col gap-1 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-white">{rec.description ?? 'Serviço'}</p>
                  <p className="mt-0.5 text-[12px] text-slate-400">
                    {rec.customers?.name ?? 'Sem cliente vinculado'} · {formatDate(rec.service_date, locale)}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-white">{formatCurrency(rec.amount_due ?? 0, locale, currency)}</span>
                    <Badge variant={PAYMENT_STATUS_VARIANT[rec.payment_status] ?? 'slate'}>
                      {PAYMENT_STATUS_LABEL[rec.payment_status] ?? rec.payment_status}
                    </Badge>
                  </div>
                  {rec.amount_paid_to_employee > 0 && (
                    <p className="text-[11px] text-slate-400">
                      Pago {formatCurrency(rec.amount_paid_to_employee, locale, currency)}
                      {rec.payment_status === 'partial' &&
                        ` · falta ${formatCurrency(Math.max((rec.amount_due ?? 0) - rec.amount_paid_to_employee, 0), locale, currency)}`}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
