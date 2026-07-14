import { createClient } from '@/lib/supabase/server'
import { TrendingUp, TrendingDown, Percent, Users } from 'lucide-react'
import { Card, CardHeader, PageHeader } from '@/components/ui/dashboard-ui'
import { getMonthlyDre, monthKey, USD_BRL_RATE, type MonthlyDre } from '@/lib/admin-metrics'

export const dynamic = 'force-dynamic'

function fmtBrl(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function fmtBrlShort(v: number) {
  const abs = Math.abs(v)
  if (abs >= 1000) return `${v < 0 ? '-' : ''}R$ ${(abs / 1000).toFixed(1)}k`
  return fmtBrl(v)
}

function parseMonth(value: string | undefined, fallback: Date): Date {
  if (value && /^\d{4}-\d{2}$/.test(value)) {
    const [year = 0, month = 1] = value.split('-').map(Number)
    return new Date(year, month - 1, 1)
  }
  return fallback
}

/** Receita consolidada em R$ do mês (USD convertido pela taxa fixa). */
function revenueTotalBrl(m: MonthlyDre): number {
  return m.revenueBrl + m.revenueUsd * USD_BRL_RATE
}

export default async function FinanceiroPage({
  searchParams,
}: {
  searchParams: Promise<{ de?: string; ate?: string }>
}) {
  const params = await searchParams
  const now = new Date()

  const defaultFrom = new Date(now.getFullYear(), now.getMonth() - 11, 1)
  const from = parseMonth(params.de, defaultFrom)
  const to = parseMonth(params.ate, new Date(now.getFullYear(), now.getMonth(), 1))

  const supabase = await createClient()
  const { months, apiCostsAvailable } = await getMonthlyDre(supabase, from, to)

  const totals = months.reduce(
    (acc, m) => ({
      revenue: acc.revenue + revenueTotalBrl(m),
      costs: acc.costs + m.systemCostsBrl + m.apiCostsBrl,
      result: acc.result + m.resultBrl,
      newClients: acc.newClients + m.newClients,
      cancellations: acc.cancellations + m.cancellations,
    }),
    { revenue: 0, costs: 0, result: 0, newClients: 0, cancellations: 0 },
  )
  const totalMargin = totals.revenue > 0 ? (totals.result / totals.revenue) * 100 : null

  const maxRevenue = Math.max(...months.map((m) => revenueTotalBrl(m)), 1)
  const maxClients = Math.max(...months.map((m) => Math.max(m.newClients, m.cancellations)), 1)

  const kpis = [
    { label: 'Receita no período', value: fmtBrlShort(totals.revenue), icon: TrendingUp, grad: 'from-emerald-400 to-green-500' },
    { label: 'Custos no período', value: fmtBrlShort(totals.costs), icon: TrendingDown, grad: 'from-rose-400 to-red-500' },
    {
      label: 'Margem no período',
      value: totalMargin === null ? '—' : `${totalMargin.toFixed(1)}%`,
      icon: Percent,
      grad: 'from-cyan-400 to-blue-500',
    },
    {
      label: 'Clientes (novos − cancel.)',
      value: `${totals.newClients} − ${totals.cancellations}`,
      icon: Users,
      grad: 'from-violet-400 to-purple-500',
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="operação alizo"
        title="Financeiro — DRE mensal"
        subtitle="Receita, custos e margem mês a mês. Escolha qualquer período de até 12 meses."
        action={
          <form className="flex items-end gap-2" method="get">
            <label className="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
              De
              <input
                type="month"
                name="de"
                defaultValue={monthKey(from)}
                className="rounded-lg px-2.5 py-1.5 text-xs text-white"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}
              />
            </label>
            <label className="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
              Até
              <input
                type="month"
                name="ate"
                defaultValue={monthKey(to)}
                className="rounded-lg px-2.5 py-1.5 text-xs text-white"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}
              />
            </label>
            <button
              type="submit"
              className="rounded-lg px-3 py-1.5 text-xs font-bold text-white"
              style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)' }}
            >
              Aplicar
            </button>
          </form>
        }
      />

      {/* KPIs do período */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map(({ label, value, icon: Icon, grad }) => (
          <div
            key={label}
            className="relative overflow-hidden rounded-2xl bg-[#141a2b]"
            style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.06)' }}
          >
            <div className={`absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r ${grad}`} />
            <div className="p-4 pt-5">
              <div
                className={`flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br ${grad}`}
                style={{ boxShadow: '0 4px 10px rgba(0,0,0,0.3)' }}
              >
                <Icon size={15} className="text-white" />
              </div>
              <p className="mt-3 text-[10px] font-black uppercase tracking-[0.1em] text-slate-500">{label}</p>
              <p className="mt-1 text-xl font-black tracking-tight text-white">{value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Gráficos de crescimento */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <CardHeader eyebrow="crescimento" title="Receita por mês (R$)" />
          <div className="flex h-36 items-end gap-2">
            {months.map((m) => {
              const revenue = revenueTotalBrl(m)
              return (
                <div key={m.month} className="flex flex-1 flex-col items-center gap-1.5">
                  <div
                    className="w-full rounded-t-lg"
                    style={{
                      height: `${revenue === 0 ? 6 : (revenue / maxRevenue) * 100}%`,
                      background:
                        revenue > 0 ? 'linear-gradient(180deg, #4ade80 0%, #16a34a 100%)' : 'rgba(255,255,255,0.06)',
                      minHeight: 6,
                    }}
                    title={fmtBrl(revenue)}
                  />
                  <span className="text-[9px] font-bold text-slate-400">{fmtBrlShort(revenue).replace('R$ ', '')}</span>
                  <span className="text-[9px] text-slate-600">{m.label}</span>
                </div>
              )
            })}
          </div>
        </Card>

        <Card className="p-5">
          <CardHeader eyebrow="crescimento" title="Novos clientes × cancelamentos" />
          <div className="flex h-36 items-end gap-2">
            {months.map((m) => (
              <div key={m.month} className="flex flex-1 flex-col items-center gap-1.5">
                <div className="flex w-full items-end justify-center gap-1" style={{ height: '100%' }}>
                  <div
                    className="w-1/2 rounded-t-md"
                    style={{
                      height: `${m.newClients === 0 ? 6 : (m.newClients / maxClients) * 100}%`,
                      background: m.newClients > 0 ? 'linear-gradient(180deg, #22d3ee, #4361ee)' : 'rgba(255,255,255,0.06)',
                      minHeight: 6,
                    }}
                    title={`${m.newClients} novos`}
                  />
                  <div
                    className="w-1/2 rounded-t-md"
                    style={{
                      height: `${m.cancellations === 0 ? 6 : (m.cancellations / maxClients) * 100}%`,
                      background: m.cancellations > 0 ? 'linear-gradient(180deg, #fb7185, #e11d48)' : 'rgba(255,255,255,0.06)',
                      minHeight: 6,
                    }}
                    title={`${m.cancellations} cancelamentos`}
                  />
                </div>
                <span className="text-[9px] font-bold text-slate-400">
                  {m.newClients}/{m.cancellations}
                </span>
                <span className="text-[9px] text-slate-600">{m.label}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-4 text-[10px] text-slate-500">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm" style={{ background: '#22d3ee' }} /> novos
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm" style={{ background: '#fb7185' }} /> cancelamentos
            </span>
          </div>
        </Card>
      </div>

      {/* Tabela DRE */}
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[880px] text-sm">
          <thead>
            <tr className="text-left" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              {['Mês', 'Receita (paga)', 'A receber', 'Custos sistema', 'Custo APIs (est.)', 'Resultado', 'Margem', 'Novos', 'Cancel.', 'Churn'].map(
                (h) => (
                  <th key={h} className="px-4 py-3 text-[10px] font-black uppercase tracking-wider text-slate-500">
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {months.map((m) => (
              <tr key={m.month} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                <td className="px-4 py-3 font-bold capitalize text-white">{m.label}</td>
                <td className="px-4 py-3 text-emerald-400">
                  {fmtBrl(m.revenueBrl)}
                  {m.revenueUsd > 0 && (
                    <span className="block text-[10px] text-slate-500">
                      + US$ {m.revenueUsd.toFixed(2)} (≈{fmtBrlShort(m.revenueUsd * USD_BRL_RATE)})
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-slate-400">{fmtBrl(m.pendingBrl)}</td>
                <td className="px-4 py-3 text-slate-400">{fmtBrl(m.systemCostsBrl)}</td>
                <td className="px-4 py-3 text-slate-400">{fmtBrl(m.apiCostsBrl)}</td>
                <td className={`px-4 py-3 font-bold ${m.resultBrl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {fmtBrl(m.resultBrl)}
                </td>
                <td className="px-4 py-3 text-slate-300">{m.marginPct === null ? '—' : `${m.marginPct.toFixed(1)}%`}</td>
                <td className="px-4 py-3 text-slate-300">{m.newClients}</td>
                <td className="px-4 py-3 text-slate-300">{m.cancellations}</td>
                <td className="px-4 py-3 text-slate-300">{m.churnPct === null ? '—' : `${m.churnPct.toFixed(1)}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <p className="text-[11px] leading-relaxed text-slate-600">
        <strong className="text-slate-500">Como ler estes números:</strong> receita e custos de sistema vêm dos
        lançamentos de <em>Cobranças</em> (exatos; receita conta o que foi marcado como pago, pelo mês do pagamento).
        Custo de APIs é <em>estimado</em> pelo uso registrado (tokens/chamadas × preço de tabela) e convertido a R$ pela
        taxa fixa US$ 1 = {fmtBrl(USD_BRL_RATE)} (env <code>USD_BRL_RATE</code>).
        {!apiCostsAvailable && ' Registro de uso de API ainda indisponível — aplique a migration 010.'}
        {' '}Churn = cancelamentos ÷ clientes ativos no início do mês. Margem = resultado ÷ receita.
      </p>
    </div>
  )
}
