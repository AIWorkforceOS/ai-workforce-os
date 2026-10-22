import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getAppUser } from '@/lib/app-user'
import { Card, KpiCard, PageHeader } from '@/components/ui/dashboard-ui'
import { sellerMetrics, totalsOf, type MetricActivity, type MetricLead, type MetricUser } from '@/lib/crm/seller-metrics'

export const dynamic = 'force-dynamic'

const PERIODS = [7, 30, 90] as const

/** Métricas por vendedor (responsável do lead): carteira, conversão, atividade registrada, retornos atrasados e leads parados. */
export default async function CrmMetricsPage({ searchParams }: { searchParams: Promise<{ dias?: string }> }) {
  const { dias } = await searchParams
  const days = PERIODS.find((p) => String(p) === dias) ?? 30
  const supabase = await createClient()
  const appUser = await getAppUser()

  const [{ data: leadData }, { data: userData }, { data: unitData }, activityRes] = await Promise.all([
    supabase.from('leads').select('id, status, owner_user_id, created_at, updated_at, unit_id').limit(5000),
    supabase.from('users').select('id, name, email').eq('role', 'admin').eq('is_active', true),
    supabase.from('units').select('id, timezone').limit(50),
    supabase.from('lead_activities').select('lead_id, kind, created_by, created_at, due_at, done_at').order('created_at', { ascending: false }).limit(10000),
  ])
  const leads = (leadData ?? []) as unknown as MetricLead[]
  const activities = (activityRes.error ? [] : (activityRes.data ?? [])) as unknown as MetricActivity[]
  const timeZone = ((unitData ?? []) as { timezone: string | null }[])[0]?.timezone ?? 'America/Sao_Paulo'

  const rows = sellerMetrics({ leads, activities, users: (userData ?? []) as MetricUser[], now: new Date(), days, timeZone })
  const totals = totalsOf(rows)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="vendas"
        title="Métricas por vendedor"
        subtitle={`Quem está cuidando de quê, nos últimos ${days} dias. O responsável é o definido em cada lead.`}
        action={
          <div className="flex items-center gap-2">
            {PERIODS.map((p) => (
              <a key={p} href={`?dias=${p}`} className={`rounded-xl px-3 py-2 text-xs font-bold ${p === days ? 'bg-white/10 text-white' : 'text-slate-400 hover:bg-white/5'}`} style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
                {p} dias
              </a>
            ))}
            <Link href="/dashboard/crm" className="rounded-xl px-3 py-2 text-xs font-bold text-slate-300 hover:bg-white/5" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
              Voltar ao funil
            </Link>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="Leads com responsável" value={String(totals.assigned - (rows.find((r) => r.userId === null)?.assigned ?? 0))} gradient="from-indigo-400 to-indigo-500" />
        <KpiCard label={`Convertidos (${days}d)`} value={String(totals.wonInPeriod)} gradient="from-green-400 to-emerald-500" />
        <KpiCard label="Retornos atrasados" value={String(totals.overdueFollowups)} gradient="from-amber-400 to-orange-500" />
        <KpiCard label="Leads parados" value={String(totals.untouched)} gradient="from-purple-400 to-violet-500" />
      </div>

      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[820px] text-left text-xs">
          <thead>
            <tr className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
              {['Vendedor', 'Leads', 'Ativos', 'Convertidos', 'Conversão', `Novos (${days}d)`, 'Ligações', 'Mensagens', 'Notas', 'Retornos feitos', 'Atrasados', 'Parados'].map((h) => (
                <th key={h} className="px-3 py-3">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.userId ?? 'none'} className="border-t" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
                <td className="px-3 py-2.5 font-semibold text-white">
                  {r.name}
                  {r.userId && r.userId === appUser?.id ? <span className="ml-1.5 text-[10px] text-cyan-300">você</span> : null}
                </td>
                <td className="px-3 py-2.5 text-slate-200">{r.assigned}</td>
                <td className="px-3 py-2.5 text-slate-200">{r.active}</td>
                <td className="px-3 py-2.5 text-slate-200">
                  {r.won}
                  {r.wonInPeriod > 0 ? <span className="ml-1 text-emerald-400">(+{r.wonInPeriod})</span> : null}
                </td>
                <td className="px-3 py-2.5 text-slate-200">{r.assigned > 0 ? `${r.conversionRate}%` : '—'}</td>
                <td className="px-3 py-2.5 text-slate-200">{r.newInPeriod}</td>
                <td className="px-3 py-2.5 text-slate-200">{r.calls}</td>
                <td className="px-3 py-2.5 text-slate-200">{r.messages}</td>
                <td className="px-3 py-2.5 text-slate-200">{r.notes}</td>
                <td className="px-3 py-2.5 text-slate-200">{r.followupsDone}</td>
                <td className={`px-3 py-2.5 font-semibold ${r.overdueFollowups > 0 ? 'text-red-400' : 'text-slate-200'}`}>{r.overdueFollowups}</td>
                <td className={`px-3 py-2.5 font-semibold ${r.untouched > 0 ? 'text-amber-400' : 'text-slate-200'}`}>{r.untouched}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <p className="text-[11px] text-slate-500">
        Conversão = convertidos ÷ leads do vendedor. “(+N)” = convertidos cuja última atualização caiu no período (o sistema ainda não guarda a data exata da conversão). Ligações, mensagens e notas contam quem registrou. “Parados” = leads em andamento sem nenhum registro no período.
      </p>
    </div>
  )
}
