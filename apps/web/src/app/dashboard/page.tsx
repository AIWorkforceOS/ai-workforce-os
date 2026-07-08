import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getAppUser } from '@/lib/app-user'
import { LeadsByDayChart } from '@/components/dashboard/leads-by-day-chart'
import { IntegrationsStatusCard } from '@/components/dashboard/integrations-status'
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

function greeting(now: Date): string {
  const hour = Number(
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false }).format(now),
  )
  if (hour < 12) return 'Bom dia'
  if (hour < 18) return 'Boa tarde'
  return 'Boa noite'
}

export default async function DashboardPage() {
  const supabase = await createClient()
  const appUser = await getAppUser()
  const isSuperAdmin = appUser?.isSuperAdmin ?? false
  const firstName = (appUser?.name ?? appUser?.email ?? 'você').split(/[\s@]/)[0]

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
  const unitsWithoutWhatsApp = activeUnits.filter((u) => !u.whatsapp_phone)

  const financialRows = (financialRecords ?? []) as Array<{
    id: string; type: string; amount: number; status: string; description: string; due_date: string | null
  }>
  const totalReceivable = financialRows.filter(r => r.type === 'receivable' && r.status === 'pending').reduce((s, r) => s + Number(r.amount), 0)
  const totalPayable = financialRows.filter(r => r.type === 'payable' && r.status === 'pending').reduce((s, r) => s + Number(r.amount), 0)
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

  // KPI cards config — card de Empresas só para a equipe Alizo
  const kpiCards = [
    ...(isSuperAdmin
      ? [
          {
            label: 'Empresas',
            value: orgRows.length,
            sub: `${activeOrgs.length} ativas`,
            icon: Building2,
            href: '/dashboard/organizations',
            gradient: 'from-blue-500 to-indigo-600',
            iconGrad: 'from-blue-400 to-indigo-500',
            topBar: 'from-blue-400 to-indigo-500',
          },
        ]
      : []),
    {
      label: 'Unidades',
      value: unitRows.length,
      sub: `${activeUnits.length} ativas`,
      icon: MapPin,
      href: '/dashboard/units',
      gradient: 'from-violet-500 to-purple-600',
      iconGrad: 'from-violet-400 to-purple-500',
      topBar: 'from-violet-400 to-purple-500',
    },
    {
      label: 'Funcionários',
      value: (employees ?? []).length,
      sub: 'cadastrados',
      icon: Users,
      href: '/dashboard/employees',
      gradient: 'from-orange-400 to-red-500',
      iconGrad: 'from-orange-400 to-red-400',
      topBar: 'from-orange-400 to-red-400',
    },
    {
      label: 'Leads',
      value: totalLeads ?? 0,
      sub: `+${newLeads24h ?? 0} nas últimas 24h`,
      icon: ArrowUpRight,
      href: '/dashboard/leads',
      gradient: 'from-emerald-400 to-green-600',
      iconGrad: 'from-emerald-400 to-green-500',
      topBar: 'from-emerald-400 to-green-500',
    },
    {
      label: 'Fechamentos',
      value: wonLeads ?? 0,
      sub: 'contratos fechados',
      icon: CheckCircle2,
      href: '/dashboard/results',
      gradient: 'from-green-500 to-teal-600',
      iconGrad: 'from-green-500 to-teal-500',
      topBar: 'from-green-500 to-teal-500',
    },
    {
      label: 'Conversas hoje',
      value: conversationsToday ?? 0,
      sub: 'mensagens enviadas',
      icon: MessageSquare,
      href: '/dashboard/conversations',
      gradient: 'from-sky-400 to-blue-500',
      iconGrad: 'from-sky-400 to-blue-400',
      topBar: 'from-sky-400 to-blue-400',
    },
  ]

  // Supress unused var warning
  void leadsByUnit

  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-500">Visão geral</p>
          <h1 className="mt-0.5 text-2xl font-black tracking-tight text-white">{greeting(now)}, {firstName}! 👋</h1>
          <p className="mt-0.5 text-sm capitalize" style={{ color: 'rgba(148,163,184,0.7)' }}>Seu workforce de IA está trabalhando — {monthName}</p>
        </div>
        {isSuperAdmin ? (
          <Link
            href="/dashboard/organizations/new"
            className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-bold text-white transition-all hover:scale-[1.02] active:scale-[0.98]"
            style={{
              background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)',
              boxShadow: '0 4px 14px rgba(6,182,212,0.3)',
            }}
          >
            <Building2 size={14} />
            Nova empresa
          </Link>
        ) : (
          <Link
            href="/dashboard/units/new"
            className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-bold text-white transition-all hover:scale-[1.02] active:scale-[0.98]"
            style={{
              background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)',
              boxShadow: '0 4px 14px rgba(6,182,212,0.3)',
            }}
          >
            <MapPin size={14} />
            Nova unidade
          </Link>
        )}
      </div>

      {/* KPI Cards — next-gen */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {kpiCards.map(({ label, value, sub, icon: Icon, href, topBar, iconGrad }) => (
          <Link
            key={label}
            href={href}
            className="group relative overflow-hidden rounded-2xl transition-all duration-200 hover:-translate-y-0.5"
            style={{
              background: '#141a2b',
              boxShadow: '0 1px 3px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.06)',
            }}
          >
            {/* Gradient top accent */}
            <div className={`absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r ${topBar}`} />

            <div className="p-4 pt-5">
              {/* Icon */}
              <div
                className={`flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ${iconGrad}`}
                style={{ boxShadow: '0 4px 10px rgba(0,0,0,0.3)' }}
              >
                <Icon size={16} className="text-white" />
              </div>

              {/* Value */}
              <p className="mt-3 text-[30px] font-black leading-none tracking-tight text-white">
                {value}
              </p>
              <p className="mt-1.5 text-[10px] font-black uppercase tracking-[0.1em] text-slate-400">
                {label}
              </p>
              <p className="mt-0.5 text-[11px] text-slate-500">{sub}</p>
            </div>
          </Link>
        ))}
      </div>

      {/* Financial + WhatsApp status */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Financial summary */}
        <div
          className="col-span-1 rounded-2xl p-5"
          style={{ background: '#141a2b', boxShadow: '0 1px 3px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.06)' }}
        >
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="text-[9px] font-black uppercase tracking-[0.15em] text-slate-500">módulo</p>
              <h2 className="text-sm font-bold text-white">Financeiro</h2>
            </div>
            <Link href="/dashboard/financial" className="rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors" style={{ color: '#06b6d4' }}>
              Ver tudo →
            </Link>
          </div>

          <div className="space-y-2.5">
            {/* A receber */}
            <div
              className="flex items-center justify-between rounded-xl p-3.5"
              style={{ background: 'linear-gradient(135deg, rgba(34,197,94,0.08) 0%, rgba(16,185,129,0.05) 100%)', border: '1px solid rgba(34,197,94,0.15)' }}
            >
              <div>
                <p className="text-[9px] font-black uppercase tracking-widest text-green-600">A receber</p>
                <p className="mt-0.5 text-xl font-black text-green-800">
                  {totalReceivable > 0 ? `R$ ${totalReceivable.toLocaleString('pt-BR')}` : '—'}
                </p>
              </div>
              <div className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: 'linear-gradient(135deg, #22c55e, #059669)', boxShadow: '0 4px 10px rgba(34,197,94,0.25)' }}>
                <Wallet size={14} className="text-white" />
              </div>
            </div>

            {/* A pagar */}
            <div
              className="flex items-center justify-between rounded-xl p-3.5"
              style={{ background: 'linear-gradient(135deg, rgba(239,68,68,0.07) 0%, rgba(220,38,38,0.04) 100%)', border: '1px solid rgba(239,68,68,0.12)' }}
            >
              <div>
                <p className="text-[9px] font-black uppercase tracking-widest text-red-500">A pagar</p>
                <p className="mt-0.5 text-xl font-black text-red-800">
                  {totalPayable > 0 ? `R$ ${totalPayable.toLocaleString('pt-BR')}` : '—'}
                </p>
              </div>
              <div className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: 'linear-gradient(135deg, #ef4444, #dc2626)', boxShadow: '0 4px 10px rgba(239,68,68,0.2)' }}>
                <TrendingUp size={14} className="text-white" />
              </div>
            </div>

            {/* Custo sistema — visão interna Alizo */}
            {isSuperAdmin && (
              <div
                className="flex items-center justify-between rounded-xl p-3.5"
                style={{ background: 'rgba(248,250,252,0.8)', border: '1px solid rgba(226,232,240,0.8)' }}
              >
                <div>
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Custo sistema</p>
                  <p className="mt-0.5 text-xl font-black text-slate-700">
                    {totalSystemCost > 0 ? `R$ ${totalSystemCost.toLocaleString('pt-BR')}` : '—'}
                  </p>
                </div>
              </div>
            )}
          </div>

          {financialRows.length === 0 && (
            <div className="mt-3 rounded-xl px-4 py-3 text-center" style={{ border: '1px dashed rgba(255,255,255,0.1)' }}>
              <p className="text-xs text-slate-500">Nenhum registro financeiro ainda.</p>
              <Link href="/dashboard/financial/new" className="mt-1 block text-xs font-semibold hover:underline" style={{ color: '#06b6d4' }}>
                Adicionar cobrança
              </Link>
            </div>
          )}
        </div>

        {/* WhatsApp status */}
        <div
          className="col-span-1 rounded-2xl p-5 lg:col-span-2"
          style={{ background: '#141a2b', boxShadow: '0 1px 3px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.06)' }}
        >
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="text-[9px] font-black uppercase tracking-[0.15em] text-slate-500">integração</p>
              <h2 className="text-sm font-bold text-white">Status WhatsApp por unidade</h2>
            </div>
            <Link href="/dashboard/units" className="rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors" style={{ color: '#06b6d4' }}>
              Ver todas →
            </Link>
          </div>

          {unitRows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <p className="text-sm text-slate-500">Nenhuma unidade cadastrada.</p>
              <Link href="/dashboard/units/new" className="text-sm font-semibold hover:underline" style={{ color: '#06b6d4' }}>Criar primeira unidade</Link>
            </div>
          ) : (
            <div style={{ borderColor: 'rgba(255,255,255,0.05)' }} className="divide-y">
              {unitRows.slice(0, 6).map((unit) => (
                <div key={unit.id} className="flex items-center justify-between py-2.5">
                  <div>
                    <Link
                      href={`/dashboard/units/${unit.id}`}
                      className="text-sm font-semibold text-white transition-colors hover:text-cyan-400"
                    >
                      {unit.name}
                    </Link>
                    <p className="text-[11px] text-slate-500">
                      {unit.region_city ?? '—'}
                      {unit.region_state ? `, ${unit.region_state}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {unit.whatsapp_phone ? (
                      <span
                        className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold"
                        style={{ background: 'rgba(34,197,94,0.12)', color: '#4ade80' }}
                      >
                        <CheckCircle2 size={10} />
                        {unit.whatsapp_phone}
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium text-slate-500" style={{ background: 'rgba(255,255,255,0.05)' }}>
                        <WifiOff size={10} />
                        Sem conexão
                      </span>
                    )}
                  </div>
                </div>
              ))}
              {unitRows.length > 6 && (
                <p className="pt-2.5 text-center text-xs text-slate-500">
                  +{unitRows.length - 6} outras unidades
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Chart + Alerts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div
          className="col-span-2 rounded-2xl p-5"
          style={{ background: '#141a2b', boxShadow: '0 1px 3px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.06)' }}
        >
          <div className="mb-4">
            <p className="text-[9px] font-black uppercase tracking-[0.15em] text-slate-500">tendência</p>
            <h2 className="text-sm font-bold text-white">Leads por dia — últimos 7 dias</h2>
          </div>
          <LeadsByDayChart counts={leadsByDay} />
        </div>

        {/* Alerts */}
        <div
          className="rounded-2xl p-5"
          style={{ background: '#141a2b', boxShadow: '0 1px 3px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.06)' }}
        >
          <div className="mb-4">
            <p className="text-[9px] font-black uppercase tracking-[0.15em] text-slate-500">sistema</p>
            <h2 className="text-sm font-bold text-white">Alertas</h2>
          </div>
          <div className="space-y-2.5">
            {unitsWithoutWhatsApp.length > 0 && (
              <div className="flex gap-3 rounded-xl p-3" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)' }}>
                <AlertCircle size={15} className="mt-0.5 flex-shrink-0 text-amber-500" />
                <div>
                  <p className="text-xs font-bold text-amber-800">
                    {unitsWithoutWhatsApp.length} unidade{unitsWithoutWhatsApp.length > 1 ? 's' : ''} sem WhatsApp
                  </p>
                  <p className="mt-0.5 text-[11px] text-amber-700">
                    {unitsWithoutWhatsApp.slice(0, 2).map(u => u.name).join(', ')}
                    {unitsWithoutWhatsApp.length > 2 ? '...' : ''}
                  </p>
                  <Link href="/dashboard/units" className="mt-1 block text-[11px] font-semibold text-amber-700 underline">Conectar agora</Link>
                </div>
              </div>
            )}
            {orgRows.length === 0 && (
              <div className="flex gap-3 rounded-xl p-3" style={{ background: 'rgba(59,130,246,0.07)', border: '1px solid rgba(59,130,246,0.15)' }}>
                <AlertCircle size={15} className="mt-0.5 flex-shrink-0 text-blue-500" />
                <div>
                  <p className="text-xs font-bold text-blue-800">Nenhuma empresa cadastrada</p>
                  <Link href="/dashboard/organizations/new" className="mt-1 block text-[11px] font-semibold text-blue-700 underline">Cadastrar empresa</Link>
                </div>
              </div>
            )}
            {(employees ?? []).length === 0 && unitRows.length > 0 && (
              <div className="flex gap-3 rounded-xl p-3" style={{ background: 'rgba(249,115,22,0.07)', border: '1px solid rgba(249,115,22,0.15)' }}>
                <AlertCircle size={15} className="mt-0.5 flex-shrink-0 text-orange-500" />
                <div>
                  <p className="text-xs font-bold text-orange-800">Nenhum funcionário cadastrado</p>
                  <Link href="/dashboard/employees/new" className="mt-1 block text-[11px] font-semibold text-orange-700 underline">Adicionar funcionário</Link>
                </div>
              </div>
            )}
            {unitsWithoutWhatsApp.length === 0 && orgRows.length > 0 && (employees ?? []).length > 0 && (
              <div className="flex gap-3 rounded-xl p-3" style={{ background: 'rgba(6,182,212,0.08)', border: '1px solid rgba(6,182,212,0.2)' }}>
                <CheckCircle2 size={15} className="mt-0.5 flex-shrink-0 text-cyan-400" />
                <p className="text-xs font-bold text-cyan-300">Tudo configurado e funcionando!</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Saúde das integrações */}
      <IntegrationsStatusCard isSuperAdmin={isSuperAdmin} />

      {/* Recent companies — visão interna Alizo */}
      {isSuperAdmin && orgRows.length > 0 && (
        <div
          className="overflow-hidden rounded-2xl"
          style={{ background: '#141a2b', boxShadow: '0 1px 3px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.06)' }}
        >
          <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <div>
              <p className="text-[9px] font-black uppercase tracking-[0.15em] text-slate-500">cadastros</p>
              <h2 className="text-sm font-bold text-white">Empresas recentes</h2>
            </div>
            <Link href="/dashboard/organizations" className="rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors" style={{ color: '#06b6d4' }}>
              Ver todas →
            </Link>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                <th className="px-5 py-3 text-left text-[10px] font-black uppercase tracking-[0.1em] text-slate-500">Empresa</th>
                <th className="px-5 py-3 text-left text-[10px] font-black uppercase tracking-[0.1em] text-slate-500">Plano</th>
                <th className="px-5 py-3 text-left text-[10px] font-black uppercase tracking-[0.1em] text-slate-500">Unidades</th>
                <th className="px-5 py-3 text-left text-[10px] font-black uppercase tracking-[0.1em] text-slate-500">Status</th>
              </tr>
            </thead>
            <tbody>
              {orgRows.slice(0, 5).map((org) => {
                const unitCount = unitRows.filter(u => u.org_id === org.id).length
                return (
                  <tr key={org.id} className="last:border-0 transition-colors hover:bg-white/[0.03]" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <td className="px-5 py-3.5">
                      <Link href="/dashboard/organizations" className="font-semibold text-white transition-colors hover:text-cyan-400">
                        {org.name}
                      </Link>
                      <p className="text-[11px] text-slate-500">{org.owner_email ?? '—'}</p>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="rounded-full px-2.5 py-1 text-[11px] font-bold capitalize" style={{ background: 'rgba(139,92,246,0.15)', color: '#a78bfa' }}>
                        {org.plan}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-slate-400 font-medium">{unitCount}</td>
                    <td className="px-5 py-3.5">
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold`}
                        style={org.is_active
                          ? { background: 'rgba(34,197,94,0.12)', color: '#4ade80' }
                          : { background: 'rgba(255,255,255,0.06)', color: '#64748b' }}>
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
