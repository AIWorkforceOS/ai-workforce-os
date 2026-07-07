import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { LeadsByDayChart } from '@/components/dashboard/leads-by-day-chart'
import {
  Building2,
  MapPin,
  Users,
  TrendingUp,
  MessageSquare,
  Wallet,
  AlertCircle,
  ArrowUpRight,
  CheckCircle2,
  WifiOff,
} from 'lucide-react'
import type { DashboardSummaryRow, Unit, Organization } from '@/lib/types'

function startOfDay(date: Date) {
  const copy = new Date(date)
  copy.setHours(0, 0, 0, 0)
  return copy
}

function toDateKey(date: Date) {
  return date.toISOString().slice(0, 10)
}

export default async function DashboardPage() {
  const supabase = await createClient()

  const now = new Date()
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const todayStart = startOfDay(now)
  const sevenDaysAgo = startOfDay(new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000))

  const [
    { data: organizations },
    { data: units },
    { data: summary },
    { count: totalLeads },
    { count: newLeads24h },
    { count: wonLeads },
    { count: conversationsToday },
    { data: recentLeads },
    { data: financialRecords },
    { data: employees },
  ] = await Promise.all([
    supabase.from('organizations').select('*').order('created_at', { ascending: false }),
    supabase.from('units').select('*').order('created_at', { ascending: false }),
    supabase.from('dashboard_summary').select('*'),
    supabase.from('leads').select('id', { count: 'exact', head: true }),
    supabase.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', since24h.toISOString()),
    supabase.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'won'),
    supabase.from('conversations').select('id', { count: 'exact', head: true }).gte('sent_at', todayStart.toISOString()),
    supabase.from('leads').select('created_at').gte('created_at', sevenDaysAgo.toISOString()),
    supabase.from('financial_records').select('*').order('created_at', { ascending: false }).limit(20),
    supabase.from('employees').select('id'),
  ])

  const unitRows = (units ?? []) as Unit[]
  const orgRows = (organizations ?? []) as Organization[]
  const summaryRows = (summary ?? []) as DashboardSummaryRow[]
  const leadsByUnit = new Map(summaryRows.map((row) => [row.unit_id, row]))

  const activeUnits = unitRows.filter((u) => u.is_active)
  const activeOrgs = orgRows.filter((o) => o.is_active)
  const unitsWithWhatsApp = unitRows.filter((u) => u.whatsapp_phone)
  const unitsWithoutWhatsApp = activeUnits.filter((u) => !u.whatsapp_phone)

  // Financial
  const financialRows = (financialRecords ?? []) as Array<{
    id: string; type: string; amount: number; status: string; description: string; due_date: string | null
  }>
  const totalReceivable = financialRows.filter(r => r.type === 'receivable' && r.status === 'pending').reduce((s, r) => s + Number(r.amount), 0)
  const totalPayable = financialRows.filter(r => r.type === 'payable' && r.status === 'pending').reduce((s, r) => s + Number(r.amount), 0)
  const totalPaid = financialRows.filter(r => r.status === 'paid').reduce((s, r) => s + Number(r.amount), 0)

  // System cost estimate (Evolution API + Supabase, rough monthly)
  const systemCostEstimate = 0 // Will come from financial_records with category='system_cost'
  const systemCostRows = financialRows.filter(r => r.type === 'payable')
  const totalSystemCost = systemCostRows.reduce((s, r) => s + Number(r.amount), 0)

  const dayBuckets = new Map<string, number>()
  for (let i = 0; i < 7; i += 1) {
    const day = new Date(sevenDaysAgo.getTime() + i * 24 * 60 * 60 * 1000)
    dayBuckets.set(toDateKey(day), 0)
  }
  for (const lead of (recentLeads as { created_at: string }[] | null) ?? []) {
    const key = toDateKey(new Date(lead.created_at))
    if (dayBuckets.has(key)) dayBuckets.set(key, (dayBuckets.get(key) ?? 0) + 1)
  }
  const leadsByDay = Array.from(dayBuckets.entries()).map(([date, count]) => ({ date, count }))

  const monthName = now.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
          <p className="mt-0.5 text-sm capitalize text-slate-500">{monthName}</p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/dashboard/organizations/new"
            className="flex items-center gap-1.5 rounded-lg bg-green-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-green-700"
          >
            <Building2 size={15} />
            Nova empresa
          </Link>
        </div>
      </div>

      {/* Primary KPI cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {[
          { label: 'Empresas', value: orgRows.length, sub: `${activeOrgs.length} ativas`, icon: Building2, color: 'text-blue-600', bg: 'bg-blue-50', href: '/dashboard/organizations' },
          { label: 'Unidades', value: unitRows.length, sub: `${activeUnits.length} ativas`, icon: MapPin, color: 'text-violet-600', bg: 'bg-violet-50', href: '/dashboard/units' },
          { label: 'Funcionários', value: (employees ?? []).length, sub: 'cadastrados', icon: Users, color: 'text-orange-600', bg: 'bg-orange-50', href: '/dashboard/employees' },
          { label: 'Leads', value: totalLeads ?? 0, sub: `+${newLeads24h ?? 0} (24h)`, icon: ArrowUpRight, color: 'text-emerald-600', bg: 'bg-emerald-50', href: '/dashboard/leads' },
          { label: 'Fechamentos', value: wonLeads ?? 0, sub: 'contratos fechados', icon: CheckCircle2, color: 'text-green-700', bg: 'bg-green-50', href: '/dashboard/results' },
          { label: 'Conversas hoje', value: conversationsToday ?? 0, sub: 'mensagens enviadas', icon: MessageSquare, color: 'text-sky-600', bg: 'bg-sky-50', href: '/dashboard/conversations' },
        ].map(({ label, value, sub, icon: Icon, color, bg, href }) => (
          <Link
            key={label}
            href={href}
            className="group flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
          >
            <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${bg}`}>
              <Icon size={18} className={color} />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900">{value}</p>
              <p className="text-xs text-slate-500">{label}</p>
              <p className="mt-0.5 text-[11px] text-slate-400">{sub}</p>
            </div>
          </Link>
        ))}
      </div>

      {/* Financial + WhatsApp status row */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Financial summary */}
        <div className="col-span-1 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Financeiro</h2>
            <Link href="/dashboard/financial" className="text-xs text-green-600 hover:underline">Ver tudo</Link>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-lg bg-green-50 px-4 py-3">
              <div>
                <p className="text-xs text-green-700">A receber</p>
                <p className="text-xl font-bold text-green-800">
                  {totalReceivable > 0 ? `R$ ${totalReceivable.toLocaleString('pt-BR')}` : '—'}
                </p>
              </div>
              <Wallet size={20} className="text-green-500" />
            </div>
            <div className="flex items-center justify-between rounded-lg bg-red-50 px-4 py-3">
              <div>
                <p className="text-xs text-red-700">A pagar</p>
                <p className="text-xl font-bold text-red-800">
                  {totalPayable > 0 ? `R$ ${totalPayable.toLocaleString('pt-BR')}` : '—'}
                </p>
              </div>
              <TrendingUp size={20} className="text-red-400" />
            </div>
            <div className="flex items-center justify-between rounded-lg bg-slate-50 px-4 py-3">
              <div>
                <p className="text-xs text-slate-500">Custo total do sistema</p>
                <p className="text-lg font-bold text-slate-800">
                  {totalSystemCost > 0 ? `R$ ${totalSystemCost.toLocaleString('pt-BR')}` : '—'}
                </p>
              </div>
            </div>
          </div>
          {financialRows.length === 0 && (
            <div className="mt-3 rounded-lg border border-dashed border-slate-200 px-4 py-3 text-center">
              <p className="text-xs text-slate-400">Nenhum registro financeiro ainda.</p>
              <Link href="/dashboard/financial/new" className="mt-1 block text-xs text-green-600 hover:underline">
                Adicionar cobrança
              </Link>
            </div>
          )}
        </div>

        {/* WhatsApp status */}
        <div className="col-span-1 rounded-xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Status WhatsApp por unidade</h2>
            <Link href="/dashboard/units" className="text-xs text-green-600 hover:underline">Ver todas</Link>
          </div>
          {unitRows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <p className="text-sm text-slate-500">Nenhuma unidade cadastrada.</p>
              <Link href="/dashboard/units/new" className="text-sm text-green-600 hover:underline">Criar primeira unidade</Link>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {unitRows.slice(0, 6).map((unit) => (
                <div key={unit.id} className="flex items-center justify-between py-2.5">
                  <div>
                    <Link
                      href={`/dashboard/units/${unit.id}`}
                      className="text-sm font-medium text-slate-900 hover:text-green-600"
                    >
                      {unit.name}
                    </Link>
                    <p className="text-xs text-slate-400">
                      {unit.region_city ?? '—'}
                      {unit.region_state ? `, ${unit.region_state}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {unit.whatsapp_phone ? (
                      <span className="flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                        <CheckCircle2 size={10} />
                        {unit.whatsapp_phone}
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                        <WifiOff size={10} />
                        Sem conexão
                      </span>
                    )}
                  </div>
                </div>
              ))}
              {unitRows.length > 6 && (
                <p className="pt-2 text-center text-xs text-slate-400">
                  +{unitRows.length - 6} outras unidades
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Leads chart + Alerts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="col-span-2 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold text-slate-900">Leads por dia (últimos 7 dias)</h2>
          <LeadsByDayChart counts={leadsByDay} />
        </div>

        {/* Alerts */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold text-slate-900">Atenção</h2>
          <div className="space-y-3">
            {unitsWithoutWhatsApp.length > 0 && (
              <div className="flex gap-3 rounded-lg bg-amber-50 p-3">
                <AlertCircle size={16} className="mt-0.5 flex-shrink-0 text-amber-600" />
                <div>
                  <p className="text-xs font-medium text-amber-800">
                    {unitsWithoutWhatsApp.length} unidade{unitsWithoutWhatsApp.length > 1 ? 's' : ''} sem WhatsApp
                  </p>
                  <p className="mt-0.5 text-xs text-amber-700">
                    {unitsWithoutWhatsApp.slice(0, 2).map(u => u.name).join(', ')}
                    {unitsWithoutWhatsApp.length > 2 ? '...' : ''}
                  </p>
                  <Link href="/dashboard/units" className="mt-1 block text-xs text-amber-800 underline">Conectar agora</Link>
                </div>
              </div>
            )}
            {orgRows.length === 0 && (
              <div className="flex gap-3 rounded-lg bg-blue-50 p-3">
                <AlertCircle size={16} className="mt-0.5 flex-shrink-0 text-blue-600" />
                <div>
                  <p className="text-xs font-medium text-blue-800">Nenhuma empresa cadastrada</p>
                  <Link href="/dashboard/organizations/new" className="mt-1 block text-xs text-blue-700 underline">Cadastrar empresa</Link>
                </div>
              </div>
            )}
            {(employees ?? []).length === 0 && unitRows.length > 0 && (
              <div className="flex gap-3 rounded-lg bg-orange-50 p-3">
                <AlertCircle size={16} className="mt-0.5 flex-shrink-0 text-orange-600" />
                <div>
                  <p className="text-xs font-medium text-orange-800">Nenhum funcionário cadastrado</p>
                  <Link href="/dashboard/employees/new" className="mt-1 block text-xs text-orange-700 underline">Adicionar funcionário</Link>
                </div>
              </div>
            )}
            {unitsWithoutWhatsApp.length === 0 && orgRows.length > 0 && (employees ?? []).length > 0 && (
              <div className="flex gap-3 rounded-lg bg-green-50 p-3">
                <CheckCircle2 size={16} className="mt-0.5 flex-shrink-0 text-green-600" />
                <p className="text-xs text-green-800">Tudo configurado e funcionando!</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Recent companies table */}
      {orgRows.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <h2 className="text-sm font-semibold text-slate-900">Empresas recentes</h2>
            <Link href="/dashboard/organizations" className="text-xs text-green-600 hover:underline">Ver todas</Link>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                <th className="px-5 py-3 font-medium">Empresa</th>
                <th className="px-5 py-3 font-medium">Plano</th>
                <th className="px-5 py-3 font-medium">Unidades</th>
                <th className="px-5 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {orgRows.slice(0, 5).map((org) => {
                const unitCount = unitRows.filter(u => u.org_id === org.id).length
                return (
                  <tr key={org.id} className="border-b border-slate-50 last:border-0">
                    <td className="px-5 py-3">
                      <Link href="/dashboard/organizations" className="font-medium text-slate-900 hover:text-green-600">
                        {org.name}
                      </Link>
                      <p className="text-xs text-slate-400">{org.owner_email ?? '—'}</p>
                    </td>
                    <td className="px-5 py-3">
                      <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium capitalize text-violet-700">
                        {org.plan}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-slate-600">{unitCount}</td>
                    <td className="px-5 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        org.is_active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
                      }`}>
                        {org.is_active ? 'Ativa' : 'Inativa'}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
