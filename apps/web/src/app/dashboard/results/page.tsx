import { createClient } from '@/lib/supabase/server'
import { TrendingUp, Trophy, Target } from 'lucide-react'
import type { Lead, Unit } from '@/lib/types'
import { Badge, Card, CardHeader, EmptyState, PageHeader, TableShell, Td, Th, Tr } from '@/components/ui/dashboard-ui'

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
  void unitRows

  const totalLeads = allLeadsRows.length
  const wonCount = won.length
  const negotiating = allLeadsRows.filter(l => l.status === 'negotiating').length
  const contacted = allLeadsRows.filter(l => l.status === 'contacted' || l.status === 'replied').length
  const conversionRate = totalLeads > 0 ? ((wonCount / totalLeads) * 100).toFixed(1) : '0'

  const financialData = await supabase
    .from('financial_records')
    .select('amount')
    .eq('type', 'receivable')
    .eq('status', 'paid')

  const totalRevenue = (financialData.data ?? []).reduce((s: number, r: { amount: number }) => s + Number(r.amount), 0)

  const kpis = [
    { label: 'Fechamentos', value: wonCount, icon: Trophy, iconGrad: 'from-amber-400 to-yellow-500', sub: 'contratos fechados' },
    { label: 'Em negociação', value: negotiating, icon: Target, iconGrad: 'from-blue-400 to-indigo-500', sub: 'leads quentes' },
    { label: 'Taxa de conversão', value: `${conversionRate}%`, icon: TrendingUp, iconGrad: 'from-emerald-400 to-green-500', sub: 'do total de leads' },
    { label: 'Receita recebida', value: totalRevenue > 0 ? fmt(totalRevenue) : '—', icon: TrendingUp, iconGrad: 'from-cyan-400 to-indigo-500', sub: 'via financeiro' },
  ]

  const pipeline = [
    { label: 'Novos', count: allLeadsRows.filter(l => l.status === 'new').length, variant: 'slate' as const },
    { label: 'Contatados', count: contacted, variant: 'blue' as const },
    { label: 'Negociando', count: negotiating, variant: 'amber' as const },
    { label: 'Fechados', count: wonCount, variant: 'green' as const },
  ]

  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow="performance" title="Resultados" subtitle="Fechamentos e performance do sistema." />

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {kpis.map(({ label, value, icon: Icon, iconGrad, sub }) => (
          <Card key={label} className="p-4">
            <div className={`mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br ${iconGrad}`} style={{ boxShadow: '0 4px 10px rgba(0,0,0,0.3)' }}>
              <Icon size={16} className="text-white" />
            </div>
            <p className="text-2xl font-black text-white">{value}</p>
            <p className="text-xs text-slate-400">{label}</p>
            <p className="mt-0.5 text-[11px] text-slate-500">{sub}</p>
          </Card>
        ))}
      </div>

      {/* Pipeline */}
      <Card className="p-5">
        <CardHeader eyebrow="funil" title="Pipeline de leads" />
        <div className="grid grid-cols-4 gap-3">
          {pipeline.map(({ label, count, variant }) => (
            <div key={label} className="rounded-xl p-4 text-center" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <p className="text-2xl font-black text-white">{count}</p>
              <div className="mt-1 inline-block"><Badge variant={variant}>{label}</Badge></div>
            </div>
          ))}
        </div>
      </Card>

      {/* Won leads table */}
      <Card className="overflow-hidden">
        <div className="px-5 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <h2 className="text-sm font-bold text-white">Fechamentos recentes</h2>
        </div>
        {won.length === 0 ? (
          <EmptyState
            icon={<Trophy size={22} className="text-white" />}
            title="Nenhum fechamento registrado ainda"
            subtitle='Os leads com status "Fechado" aparecerão aqui.'
          />
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <TableShell>
              <Th>Empresa</Th>
              <Th>Unidade</Th>
              <Th>Contato</Th>
              <Th>Setor</Th>
              <Th>Fechado em</Th>
            </TableShell>
            <tbody>
              {won.map((lead) => (
                <Tr key={lead.id}>
                  <Td>
                    <p className="font-semibold text-white">{lead.company_name}</p>
                    <p className="text-xs text-slate-500">{lead.city ?? '—'}{lead.state ? `, ${lead.state}` : ''}</p>
                  </Td>
                  <Td className="text-slate-400">{lead.units?.name ?? '—'}</Td>
                  <Td className="text-slate-400">
                    <p>{lead.contact_name ?? '—'}</p>
                    <p className="text-xs text-slate-500">{lead.phone ?? ''}</p>
                  </Td>
                  <Td>
                    {lead.sector && <Badge variant="purple">{lead.sector}</Badge>}
                  </Td>
                  <Td className="text-slate-400">{new Date(lead.updated_at).toLocaleDateString('pt-BR')}</Td>
                </Tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </Card>
    </div>
  )
}
