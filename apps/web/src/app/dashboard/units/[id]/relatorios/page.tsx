import Link from 'next/link'
import { notFound } from 'next/navigation'
import { BarChart3, CalendarDays, ChevronLeft, ChevronRight, ClipboardList } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Card, KpiCard, Label, PageHeader, Select } from '@/components/ui/dashboard-ui'
import { currentMonthInTimezone, monthLabel, resolveSelectedMonth, shiftMonth } from '@/lib/service-operations-month'
import {
  fetchMonthlyReport,
  fetchProfessionalReport,
  isProfessionalReportPeriod,
  PROFESSIONAL_REPORT_PERIODS,
  REPORT_STATUS_OPTIONS,
  type ReportServiceOrderStatusFilter,
} from '@/lib/reports/queries'
import type { Employee, Unit } from '@/lib/types'

/**
 * Relatórios (pedido do Vinicius, 2026-09-27): "o que um profissional fez
 * nos últimos 30/60/90 dias" + "relatório geral do mês, saúde e
 * crescimento da empresa" — sem tocar em nada da Agenda existente, por
 * isso é uma rota irmã nova (mesmo padrão de /operacao), não algo
 * embutido em /agenda/calendario.
 *
 * force-dynamic: mesmo motivo documentado em operacao/page.tsx — sem
 * isso, o Data Cache do Next pode mostrar filtro/dado desatualizado
 * depois de trocar profissional/mês e recarregar.
 */
export const dynamic = 'force-dynamic'

function formatMoney(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatGrowth(value: number | null): string {
  if (value === null) return 'Sem dado do mês anterior'
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(1)}% vs mês anterior`
}

export default async function UnitReportsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ view?: string; employeeId?: string; status?: string; days?: string; month?: string }>
}) {
  const { id } = await params
  const { view: viewParam, employeeId: employeeIdParam, status: statusParam, days: daysParam, month: monthParam } = await searchParams
  const supabase = await createClient()

  const { data: unit } = await supabase.from('units').select('*').eq('id', id).single()
  if (!unit) notFound()
  const unitRow = unit as Unit

  const { data: employeesData } = await supabase.from('employees').select('*').eq('unit_id', id).eq('is_active', true).order('name')
  const employees = (employeesData ?? []) as Employee[]

  const view = viewParam === 'mensal' ? 'mensal' : 'profissional'

  const tabHeaderAction = (
    <div className="flex items-center gap-2">
      <Link
        href={`/dashboard/units/${id}/agenda/calendario`}
        className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold text-slate-300 transition-all hover:bg-white/5"
        style={{ border: '1px solid rgba(255,255,255,0.08)' }}
      >
        <CalendarDays size={13} />
        Agenda
      </Link>
      <Link
        href={`/dashboard/units/${id}/operacao`}
        className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold text-slate-300 transition-all hover:bg-white/5"
        style={{ border: '1px solid rgba(255,255,255,0.08)' }}
      >
        <ClipboardList size={13} />
        Operação
      </Link>
    </div>
  )

  return (
    <div className="flex flex-col gap-5">
      <PageHeader eyebrow="Agenda" title="Relatórios" subtitle="O que cada profissional fez e como o negócio está indo mês a mês." action={tabHeaderAction} />

      <div className="flex gap-2">
        <Link
          href={`/dashboard/units/${id}/relatorios?view=profissional`}
          className="rounded-xl px-4 py-2 text-xs font-bold transition-colors"
          style={
            view === 'profissional'
              ? { background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)', color: 'white' }
              : { border: '1px solid rgba(255,255,255,0.08)', color: '#94a3b8' }
          }
        >
          Por profissional
        </Link>
        <Link
          href={`/dashboard/units/${id}/relatorios?view=mensal`}
          className="rounded-xl px-4 py-2 text-xs font-bold transition-colors"
          style={
            view === 'mensal'
              ? { background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)', color: 'white' }
              : { border: '1px solid rgba(255,255,255,0.08)', color: '#94a3b8' }
          }
        >
          Relatório geral do mês
        </Link>
      </div>

      {view === 'profissional' ? (
        <ProfessionalReportView unitId={id} timezone={unitRow.timezone} employees={employees} employeeIdParam={employeeIdParam} statusParam={statusParam} daysParam={daysParam} supabaseArgs={supabase} />
      ) : (
        <MonthlyReportView unitId={id} timezone={unitRow.timezone} monthParam={monthParam} supabaseArgs={supabase} />
      )}
    </div>
  )
}

async function ProfessionalReportView({
  unitId,
  timezone,
  employees,
  employeeIdParam,
  statusParam,
  daysParam,
  supabaseArgs,
}: {
  unitId: string
  timezone: string
  employees: Employee[]
  employeeIdParam: string | undefined
  statusParam: string | undefined
  daysParam: string | undefined
  supabaseArgs: Awaited<ReturnType<typeof createClient>>
}) {
  if (employees.length === 0) {
    return <Card className="px-5 py-8 text-center text-sm text-slate-500">Nenhum profissional ativo nesta unidade ainda.</Card>
  }

  const selectedEmployeeId = employeeIdParam && employees.some((e) => e.id === employeeIdParam) ? employeeIdParam : employees[0]!.id
  const status: ReportServiceOrderStatusFilter = REPORT_STATUS_OPTIONS.some((o) => o.value === statusParam)
    ? (statusParam as ReportServiceOrderStatusFilter)
    : 'all'
  const parsedDays = Number(daysParam)
  const days = isProfessionalReportPeriod(parsedDays) ? parsedDays : 30

  const report = await fetchProfessionalReport(supabaseArgs, unitId, timezone, { employeeId: selectedEmployeeId, status, days })
  const selectedEmployee = employees.find((e) => e.id === selectedEmployeeId)

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-3 p-4">
        <form method="get" className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="view" value="profissional" />
          <div className="flex flex-col gap-1">
            <Label>Profissional</Label>
            <Select name="employeeId" defaultValue={selectedEmployeeId} style={{ minWidth: 200 }}>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label>Status da ordem</Label>
            <Select name="status" defaultValue={status} style={{ minWidth: 160 }}>
              {REPORT_STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label>Período</Label>
            <div className="flex gap-1.5">
              {PROFESSIONAL_REPORT_PERIODS.map((preset) => (
                <button
                  key={preset}
                  type="submit"
                  name="days"
                  value={preset}
                  className="rounded-xl px-3 py-2 text-xs font-bold transition-colors"
                  style={
                    preset === days
                      ? { background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)', color: 'white' }
                      : { border: '1px solid rgba(255,255,255,0.08)', color: '#94a3b8', background: 'transparent' }
                  }
                >
                  {preset} dias
                </button>
              ))}
            </div>
          </div>
          <button
            type="submit"
            className="rounded-xl px-4 py-2 text-xs font-bold text-white transition-all"
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)' }}
          >
            Aplicar
          </button>
        </form>
      </Card>

      <p className="text-xs text-slate-500">
        {selectedEmployee?.name ?? 'Profissional'} — últimos {days} dias
        {status !== 'all' ? ` · ${REPORT_STATUS_OPTIONS.find((o) => o.value === status)?.label}` : ''}
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="Ordens no período" value={report.orders.total} icon={<BarChart3 size={16} className="text-white" />} />
        <KpiCard label="Finalizadas" value={report.orders.completed} gradient="from-emerald-400 to-green-500" />
        <KpiCard label="Em cotação" value={report.orders.quote} gradient="from-purple-400 to-violet-500" />
        <KpiCard label="Pendentes" value={report.orders.pending} gradient="from-amber-400 to-orange-500" />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiCard label="Valor cobrado do cliente" value={formatMoney(report.financials.totalOrdersAmount)} gradient="from-cyan-400 to-blue-500" />
        <KpiCard label="Já pago ao profissional" value={formatMoney(report.financials.employeePaid)} gradient="from-emerald-400 to-green-500" />
        <KpiCard label="Ainda a pagar" value={formatMoney(report.financials.employeeDue)} gradient="from-amber-400 to-orange-500" />
      </div>
    </div>
  )
}

async function MonthlyReportView({
  unitId,
  timezone,
  monthParam,
  supabaseArgs,
}: {
  unitId: string
  timezone: string
  monthParam: string | undefined
  supabaseArgs: Awaited<ReturnType<typeof createClient>>
}) {
  const currentMonth = currentMonthInTimezone(timezone)
  const selectedMonth = resolveSelectedMonth(monthParam, timezone)
  const locale = 'pt-BR'
  const selectedMonthLabel = monthLabel(selectedMonth, locale)
  const monthOptions = Array.from({ length: 26 }, (_, i) => shiftMonth(currentMonth, 1 - i))

  const report = await fetchMonthlyReport(supabaseArgs, unitId, timezone, selectedMonth)

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <form method="get" className="flex items-end gap-2">
          <input type="hidden" name="view" value="mensal" />
          <div className="flex flex-col gap-1">
            <Label>Mês</Label>
            <Select name="month" defaultValue={selectedMonth} style={{ minWidth: 180 }}>
              {monthOptions.map((m) => (
                <option key={m} value={m}>
                  {monthLabel(m, locale)}
                </option>
              ))}
            </Select>
          </div>
          <button
            type="submit"
            className="rounded-xl px-4 py-2 text-xs font-bold text-white transition-all"
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)' }}
          >
            Aplicar
          </button>
        </form>
        <div className="flex items-center gap-2">
          <Link
            href={`/dashboard/units/${unitId}/relatorios?view=mensal&month=${shiftMonth(selectedMonth, -1)}`}
            className="flex items-center gap-1 rounded-xl px-3 py-2 text-xs font-bold text-slate-300 hover:bg-white/5"
            style={{ border: '1px solid rgba(255,255,255,0.08)' }}
          >
            <ChevronLeft size={13} />
            Mês anterior
          </Link>
          <Link
            href={`/dashboard/units/${unitId}/relatorios?view=mensal&month=${shiftMonth(selectedMonth, 1)}`}
            className="flex items-center gap-1 rounded-xl px-3 py-2 text-xs font-bold text-slate-300 hover:bg-white/5"
            style={{ border: '1px solid rgba(255,255,255,0.08)' }}
          >
            Próximo mês
            <ChevronRight size={13} />
          </Link>
        </div>
      </Card>

      <p className="text-xs text-slate-500">Mostrando: {selectedMonthLabel}</p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiCard label="Valor cobrado no mês" value={formatMoney(report.financials.totalOrdersAmount)} sub={formatGrowth(report.revenueGrowthPercent)} gradient="from-cyan-400 to-blue-500" />
        <KpiCard label="Já pago à equipe" value={formatMoney(report.financials.employeePaid)} gradient="from-emerald-400 to-green-500" />
        <KpiCard label="Ainda a pagar à equipe" value={formatMoney(report.financials.employeeDue)} gradient="from-amber-400 to-orange-500" />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <KpiCard label="Ordens atendidas" value={report.orders.total} icon={<BarChart3 size={16} className="text-white" />} />
        <KpiCard label="Finalizadas" value={report.orders.completed} gradient="from-emerald-400 to-green-500" />
        <KpiCard label="Em cotação" value={report.orders.quote} gradient="from-purple-400 to-violet-500" />
        <KpiCard label="Pendentes" value={report.orders.pending} gradient="from-amber-400 to-orange-500" />
        <KpiCard label="Clientes/lojas atendidos" value={report.uniqueCustomers} gradient="from-pink-400 to-rose-500" />
      </div>
    </div>
  )
}
