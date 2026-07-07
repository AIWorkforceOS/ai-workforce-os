import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import {
  TrendingUp, DollarSign, Users, ShoppingCart,
  ArrowUpRight, BarChart3, Globe, Smartphone, Mail,
} from 'lucide-react'

function fmt(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function fmtShort(v: number) {
  if (v >= 1000) return `R$ ${(v / 1000).toFixed(1)}k`
  return fmt(v)
}

type FinancialRecord = {
  id: string; type: string; amount: number; status: string
  created_at: string; category: string
}

type Organization = {
  id: string; name: string; plan: string; created_at: string; is_active: boolean
}

type Lead = {
  id: string; created_at: string; status: string; source: string | null
  organizations?: { name: string } | null
}

const SEGMENTS: Record<string, string> = {
  franquias: 'Franquias',
  estetica: 'Estética',
  academias: 'Academias',
  educacao: 'Educação',
  saude: 'Saúde',
  varejo: 'Varejo',
  outros: 'Outros',
}

export default async function SalesPage() {
  const supabase = await createClient()
  const now = new Date()

  const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0)
  const startOfWeek = new Date(now); startOfWeek.setDate(now.getDate() - 7)
  const startOfMonth = new Date(now); startOfMonth.setDate(1); startOfMonth.setHours(0, 0, 0, 0)

  const [
    { data: allFinancial },
    { data: allOrgs },
    { data: allLeads },
    { count: newToday },
    { count: newThisWeek },
    { count: newThisMonth },
  ] = await Promise.all([
    supabase.from('financial_records').select('*').order('created_at', { ascending: false }),
    supabase.from('organizations').select('*').order('created_at', { ascending: false }),
    supabase.from('leads').select('*, organizations(name)').order('created_at', { ascending: false }),
    supabase.from('organizations').select('id', { count: 'exact', head: true }).gte('created_at', startOfDay.toISOString()),
    supabase.from('organizations').select('id', { count: 'exact', head: true }).gte('created_at', startOfWeek.toISOString()),
    supabase.from('organizations').select('id', { count: 'exact', head: true }).gte('created_at', startOfMonth.toISOString()),
  ])

  const financial = (allFinancial ?? []) as FinancialRecord[]
  const orgs = (allOrgs ?? []) as Organization[]
  const leads = (allLeads ?? []) as Lead[]

  // Revenue calcs
  const revenueDay = financial
    .filter(r => r.type === 'receivable' && r.status === 'paid' && new Date(r.created_at) >= startOfDay)
    .reduce((s, r) => s + Number(r.amount), 0)
  const revenueWeek = financial
    .filter(r => r.type === 'receivable' && r.status === 'paid' && new Date(r.created_at) >= startOfWeek)
    .reduce((s, r) => s + Number(r.amount), 0)
  const revenueMonth = financial
    .filter(r => r.type === 'receivable' && r.status === 'paid' && new Date(r.created_at) >= startOfMonth)
    .reduce((s, r) => s + Number(r.amount), 0)
  const revenueTotal = financial
    .filter(r => r.type === 'receivable' && r.status === 'paid')
    .reduce((s, r) => s + Number(r.amount), 0)

  const pendingMRR = financial
    .filter(r => r.type === 'receivable' && r.status === 'pending')
    .reduce((s, r) => s + Number(r.amount), 0)

  // Plans breakdown
  const planCounts = orgs.reduce((acc, o) => {
    acc[o.plan] = (acc[o.plan] ?? 0) + 1
    return acc
  }, {} as Record<string, number>)

  // Lead sources
  const sourceCounts = leads.reduce((acc, l) => {
    const src = l.source ?? 'direto'
    acc[src] = (acc[src] ?? 0) + 1
    return acc
  }, {} as Record<string, number>)

  // Daily signups last 7 days
  const dayBuckets: { date: string; count: number }[] = []
  for (let i = 6; i >= 0; i--) {
    const day = new Date(now)
    day.setDate(now.getDate() - i)
    day.setHours(0, 0, 0, 0)
    const nextDay = new Date(day); nextDay.setDate(day.getDate() + 1)
    const count = orgs.filter(o => {
      const d = new Date(o.created_at)
      return d >= day && d < nextDay
    }).length
    dayBuckets.push({
      date: day.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit' }),
      count,
    })
  }

  const maxCount = Math.max(...dayBuckets.map(d => d.count), 1)

  const sourceIcons: Record<string, typeof Globe> = {
    organico: Globe,
    social: Smartphone,
    email: Mail,
    direto: Users,
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-400">vendas</p>
          <h1 className="mt-0.5 text-2xl font-black tracking-tight text-slate-900">Dashboard de Vendas</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            {now.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>
        <Link
          href="/dashboard/financial/new"
          className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-bold text-white"
          style={{ background: 'linear-gradient(135deg, #22c55e, #16a34a)', boxShadow: '0 4px 14px rgba(34,197,94,0.3)' }}
        >
          <DollarSign size={14} />
          Novo lançamento
        </Link>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          {
            label: 'Receita hoje',
            value: fmtShort(revenueDay),
            sub: `${newToday ?? 0} novos clientes`,
            icon: DollarSign,
            topBar: 'from-green-400 to-emerald-500',
            iconGrad: 'from-green-500 to-emerald-500',
          },
          {
            label: 'Receita na semana',
            value: fmtShort(revenueWeek),
            sub: `${newThisWeek ?? 0} novos clientes`,
            icon: TrendingUp,
            topBar: 'from-blue-400 to-indigo-500',
            iconGrad: 'from-blue-400 to-indigo-500',
          },
          {
            label: 'Receita no mês',
            value: fmtShort(revenueMonth),
            sub: `${newThisMonth ?? 0} novos clientes`,
            icon: ShoppingCart,
            topBar: 'from-violet-400 to-purple-500',
            iconGrad: 'from-violet-400 to-purple-500',
          },
          {
            label: 'MRR pendente',
            value: fmtShort(pendingMRR),
            sub: `Total acumulado: ${fmtShort(revenueTotal)}`,
            icon: ArrowUpRight,
            topBar: 'from-amber-400 to-orange-500',
            iconGrad: 'from-amber-400 to-orange-500',
          },
        ].map(({ label, value, sub, icon: Icon, topBar, iconGrad }) => (
          <div key={label} className="relative overflow-hidden rounded-2xl bg-white"
            style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 0 0 1px rgba(226,232,240,0.7)' }}>
            <div className={`absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r ${topBar}`} />
            <div className="p-4 pt-5">
              <div className={`flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ${iconGrad}`}
                style={{ boxShadow: '0 4px 10px rgba(0,0,0,0.12)' }}>
                <Icon size={16} className="text-white" />
              </div>
              <p className="mt-3 text-[10px] font-black uppercase tracking-[0.1em] text-slate-400">{label}</p>
              <p className="mt-1 text-2xl font-black tracking-tight text-slate-900">{value}</p>
              <p className="mt-0.5 text-[11px] text-slate-400">{sub}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Chart + Plans */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Daily signups chart */}
        <div className="col-span-2 overflow-hidden rounded-2xl bg-white p-5"
          style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 0 0 1px rgba(226,232,240,0.7)' }}>
          <div className="mb-5">
            <p className="text-[9px] font-black uppercase tracking-[0.15em] text-slate-400">tendência</p>
            <h2 className="text-sm font-bold text-slate-900">Novos clientes — últimos 7 dias</h2>
          </div>

          {/* Bar chart */}
          <div className="flex items-end gap-3 h-32">
            {dayBuckets.map(({ date, count }) => (
              <div key={date} className="flex flex-1 flex-col items-center gap-1.5">
                <div className="w-full rounded-t-lg transition-all duration-500"
                  style={{
                    height: `${count === 0 ? 8 : (count / maxCount) * 100}%`,
                    background: count > 0
                      ? 'linear-gradient(180deg, #22c55e 0%, #16a34a 100%)'
                      : 'rgba(226,232,240,0.6)',
                    minHeight: 8,
                  }} />
                <span className="text-[10px] font-bold text-slate-400">{count}</span>
                <span className="text-[9px] text-slate-300">{date}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Plan breakdown */}
        <div className="rounded-2xl bg-white p-5"
          style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 0 0 1px rgba(226,232,240,0.7)' }}>
          <div className="mb-4">
            <p className="text-[9px] font-black uppercase tracking-[0.15em] text-slate-400">produtos</p>
            <h2 className="text-sm font-bold text-slate-900">Planos ativos</h2>
          </div>

          {Object.keys(planCounts).length === 0 ? (
            <p className="text-sm text-slate-400">Nenhum cliente ativo ainda.</p>
          ) : (
            <div className="space-y-3">
              {Object.entries(planCounts).map(([plan, count]) => {
                const total = orgs.length || 1
                const pct = Math.round((count / total) * 100)
                const colors: Record<string, string> = {
                  starter: '#3b82f6', pro: '#8b5cf6', enterprise: '#f59e0b',
                  basico: '#3b82f6',
                }
                const color = colors[plan] ?? '#22c55e'
                return (
                  <div key={plan}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-bold text-slate-600 capitalize">{plan}</span>
                      <span className="text-xs font-black text-slate-900">{count} cliente{count > 1 ? 's' : ''}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: color }} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          <div className="mt-5 border-t border-slate-100 pt-4">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500">Total de clientes</span>
              <span className="text-xl font-black text-slate-900">{orgs.length}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Lead sources + recent clients */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Lead sources */}
        <div className="rounded-2xl bg-white p-5"
          style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 0 0 1px rgba(226,232,240,0.7)' }}>
          <div className="mb-4">
            <p className="text-[9px] font-black uppercase tracking-[0.15em] text-slate-400">aquisição</p>
            <h2 className="text-sm font-bold text-slate-900">Origem dos clientes</h2>
          </div>

          {Object.keys(sourceCounts).length === 0 ? (
            <p className="text-sm text-slate-400">Sem dados de origem ainda.</p>
          ) : (
            <div className="space-y-3">
              {Object.entries(sourceCounts)
                .sort(([, a], [, b]) => b - a)
                .slice(0, 6)
                .map(([source, count]) => {
                  const total = leads.length || 1
                  const pct = Math.round((count / total) * 100)
                  const SrcIcon = sourceIcons[source] ?? Globe
                  return (
                    <div key={source} className="flex items-center gap-3">
                      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg"
                        style={{ background: 'rgba(34,197,94,0.1)' }}>
                        <SrcIcon size={13} className="text-green-600" />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-bold text-slate-700 capitalize">{source}</span>
                          <span className="text-xs font-black text-slate-900">{pct}%</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                          <div className="h-full rounded-full"
                            style={{ width: `${pct}%`, background: 'linear-gradient(90deg, #22c55e, #4ade80)' }} />
                        </div>
                      </div>
                      <span className="text-xs text-slate-400 w-8 text-right">{count}</span>
                    </div>
                  )
                })}
            </div>
          )}
        </div>

        {/* Recent signups */}
        <div className="overflow-hidden rounded-2xl bg-white"
          style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 0 0 1px rgba(226,232,240,0.7)' }}>
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <div>
              <p className="text-[9px] font-black uppercase tracking-[0.15em] text-slate-400">recentes</p>
              <h2 className="text-sm font-bold text-slate-900">Últimos clientes</h2>
            </div>
            <Link href="/dashboard/organizations"
              className="text-[11px] font-semibold text-green-600 hover:underline">
              Ver todos →
            </Link>
          </div>

          {orgs.length === 0 ? (
            <div className="p-8 text-center">
              <BarChart3 size={28} className="mx-auto text-slate-300" />
              <p className="mt-3 text-sm text-slate-400">Nenhum cliente cadastrado ainda</p>
              <p className="text-xs text-slate-300">As vendas aparecerão aqui automaticamente</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-50">
              {orgs.slice(0, 6).map(org => (
                <div key={org.id} className="flex items-center justify-between px-5 py-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{org.name}</p>
                    <p className="text-[11px] text-slate-400">
                      {new Date(org.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full px-2.5 py-1 text-[11px] font-bold capitalize"
                      style={{ background: 'rgba(139,92,246,0.1)', color: '#7c3aed' }}>
                      {org.plan}
                    </span>
                    <span className="rounded-full px-2.5 py-1 text-[11px] font-bold"
                      style={org.is_active
                        ? { background: 'rgba(34,197,94,0.1)', color: '#15803d' }
                        : { background: 'rgba(148,163,184,0.1)', color: '#64748b' }}>
                      {org.is_active ? 'Ativo' : 'Inativo'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
