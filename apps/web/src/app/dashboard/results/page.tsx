import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { TrendingUp, Trophy, Target } from 'lucide-react'
import type { Lead, Unit } from '@/lib/types'

function fmt(val: number) {
  return val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export default async function ResultsPage() {
  const supabase = await createClient()

  const [{ data: wonLeads }, { data: units }, { data: allLeads }] = await Promise.all([
    supabase.from('leads').select('*, units(name, region_city, region_state)').eq('status', 'won').order('updated_at', { ascending: false }),
    supabase.from('units').select('*'),
    supabase.from('leads').select('status'),
  ])

  const won = (wonLeads ?? []) as (Lead & { units?: { name: string; region_city: string | null; region_state: string | null } | null })[]
  const unitRows = (units ?? []) as Unit[]
  const allLeadsRows = (allLeads ?? []) as { status: string }[]

  const totalLeads = allLeadsRows.length
  const wonCount = won.length
  const negotiating = allLeadsRows.filter(l => l.status === 'negotiating').length
  const contacted = allLeadsRows.filter(l => l.status === 'contacted' || l.status === 'replied').length
  const conversionRate = totalLeads > 0 ? ((wonCount / totalLeads) * 100).toFixed(1) : '0'

  // Won leads from financial records (if any revenue linked)
  const financialData = await supabase
    .from('financial_records')
    .select('amount')
    .eq('type', 'receivable')
    .eq('status', 'paid')

  const totalRevenue = (financialData.data ?? []).reduce((s: number, r: { amount: number }) => s + Number(r.amount), 0)

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Resultados</h1>
        <p className="mt-0.5 text-sm text-slate-500">Fechamentos e performance do sistema.</p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: 'Fechamentos', value: wonCount, icon: Trophy, color: 'text-yellow-600', bg: 'bg-yellow-50', sub: 'contratos fechados' },
          { label: 'Em negociação', value: negotiating, icon: Target, color: 'text-blue-600', bg: 'bg-blue-50', sub: 'leads quentes' },
          { label: 'Taxa de conversão', value: `${conversionRate}%`, icon: TrendingUp, color: 'text-green-600', bg: 'bg-green-50', sub: 'do total de leads' },
          { label: 'Receita recebida', value: totalRevenue > 0 ? fmt(totalRevenue) : '—', icon: TrendingUp, color: 'text-emerald-600', bg: 'bg-emerald-50', sub: 'via financeiro' },
        ].map(({ label, value, icon: Icon, color, bg, sub }) => (
          <div key={label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className={`mb-3 flex h-9 w-9 items-center justify-center rounded-lg ${bg}`}>
              <Icon size={18} className={color} />
            </div>
            <p className="text-2xl font-bold text-slate-900">{value}</p>
            <p className="text-xs text-slate-500">{label}</p>
            <p className="mt-0.5 text-[11px] text-slate-400">{sub}</p>
          </div>
        ))}
      </div>

      {/* Pipeline */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold text-slate-900">Pipeline de leads</h2>
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: 'Novos', count: allLeadsRows.filter(l => l.status === 'new').length, color: 'bg-slate-100 text-slate-600' },
            { label: 'Contatados', count: contacted, color: 'bg-blue-100 text-blue-700' },
            { label: 'Negociando', count: negotiating, color: 'bg-amber-100 text-amber-700' },
            { label: 'Fechados', count: wonCount, color: 'bg-green-100 text-green-700' },
          ].map(({ label, count, color }) => (
            <div key={label} className="rounded-lg bg-slate-50 p-4 text-center">
              <p className="text-2xl font-bold text-slate-900">{count}</p>
              <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${color}`}>{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Won leads table */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-900">Fechamentos recentes</h2>
        </div>
        {won.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <Trophy size={28} className="text-slate-300" />
            <p className="text-sm text-slate-500">Nenhum fechamento registrado ainda.</p>
            <p className="text-xs text-slate-400">Os leads com status "Fechado" aparecerão aqui.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                <th className="px-5 py-3 font-medium">Empresa</th>
                <th className="px-5 py-3 font-medium">Unidade</th>
                <th className="px-5 py-3 font-medium">Contato</th>
                <th className="px-5 py-3 font-medium">Setor</th>
                <th className="px-5 py-3 font-medium">Fechado em</th>
              </tr>
            </thead>
            <tbody>
              {won.map((lead) => (
                <tr key={lead.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                  <td className="px-5 py-3">
                    <p className="font-medium text-slate-900">{lead.company_name}</p>
                    <p className="text-xs text-slate-400">{lead.city ?? '—'}{lead.state ? `, ${lead.state}` : ''}</p>
                  </td>
                  <td className="px-5 py-3 text-slate-600">
                    {lead.units?.name ?? '—'}
                  </td>
                  <td className="px-5 py-3 text-slate-600">
                    <p>{lead.contact_name ?? '—'}</p>
                    <p className="text-xs text-slate-400">{lead.phone ?? ''}</p>
                  </td>
                  <td className="px-5 py-3">
                    {lead.sector && (
                      <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium capitalize text-violet-700">
                        {lead.sector}
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-slate-500">
                    {new Date(lead.updated_at).toLocaleDateString('pt-BR')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
