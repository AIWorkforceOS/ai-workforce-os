import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Card, CardHeader, KpiCard, PageHeader, StatusPill } from '@/components/ui/dashboard-ui'
import { requireUnitAdmin } from '@/lib/quote-team/agent/admin-guard'
import { loadPilotOverview } from '@/lib/quote-team/agent/admin-data'
import { buildConsumptionView } from '@/lib/quote-team/agent/consumption'

export const dynamic = 'force-dynamic'
const usd = (n: number | null | undefined, d = 2) => (n == null ? '—' : `US$ ${n.toFixed(d)}`)

export default async function ConsumoIaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const guard = await requireUnitAdmin(id)
  if (!guard.ok) notFound()
  const { db, unit } = guard.ctx
  const [view, overview] = await Promise.all([buildConsumptionView(db, unit), loadPilotOverview(db, unit)])
  const b = view.balance
  const alerts: string[] = [...overview.summary.alerts]
  if (b.kind === 'estimate' && b.low) alerts.push(`Crédito estimado baixo: US$ ${b.remaining_usd.toFixed(2)} (alerta abaixo de US$ ${b.low_threshold_usd}). Confira e recarregue em Billing.`)
  if (b.kind === 'unavailable') alerts.push('Crédito real da OpenAI não verificável por API: acompanhe o saldo na página oficial de Billing.')
  if (!view.integration.api_key_configured) alerts.push('OPENAI_API_KEY não configurada: os agentes de IA não funcionam.')

  return (
    <div className="flex flex-col gap-6 pb-10">
      <PageHeader eyebrow="Super Agente de Cotações" title="Consumo de IA" subtitle={`Atualizado em ${new Date(view.updated_at).toLocaleString('pt-BR')} · ${unit.name}`} action={<Link href={`/dashboard/units/${id}/super-agente`} className="text-sm font-bold text-cyan-300 underline">← Painel do piloto</Link>} />

      {alerts.length > 0 && <Card className="p-4">{alerts.map((a, i) => <p key={i} className="text-sm text-amber-200">⚠ {a}</p>)}</Card>}

      <Card className="p-5">
        <CardHeader eyebrow="1 · Crédito real da OpenAI" title="Saldo da organização" />
        {b.kind === 'estimate' ? (
          <>
            <p className="text-2xl font-black text-white">{usd(b.remaining_usd)} <span className="text-xs font-semibold text-amber-300">ESTIMATIVA (não é saldo oficial)</span></p>
            <p className="text-xs text-slate-400">Crédito carregado informado: {usd(b.loaded_usd)} em {new Date(b.loaded_at).toLocaleDateString('pt-BR')} − custo real medido desde então {usd(b.spent_since_usd)}.</p>
          </>
        ) : (
          <p className="text-sm text-slate-300"><b className="text-white">Saldo indisponível.</b> {b.reason}</p>
        )}
        <a className="mt-2 inline-block text-sm font-bold text-cyan-300 underline" href={b.billing_url} target="_blank" rel="noreferrer">Abrir Billing da OpenAI (saldo, alertas e recarga)</a>
        <p className="mt-2 text-xs text-slate-500">Recarga automática e pagamentos NÃO são feitos por este sistema: dependem da sua aprovação direto na OpenAI.</p>
      </Card>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="2 · Consumo real da OpenAI no mês" value={usd(view.month.real_cost_usd)} sub={view.integration.admin_key_configured ? 'Costs API (organização inteira)' : 'indisponível: sem chave administrativa'} gradient="from-emerald-400 to-teal-500" />
        <KpiCard label="Consumo estimado (nosso registro)" value={usd(view.month.estimated_usd, 3)} sub="soma dos agentes desta empresa" gradient="from-blue-400 to-indigo-500" />
        <KpiCard label="Super Agente (orçamento interno)" value={usd(overview.month.total, 3)} sub={`limite mensal US$ ${overview.month.cap.toFixed(2)} por empresa`} gradient="from-violet-400 to-purple-500" />
        <KpiCard label="Custo médio por cotação" value={usd(overview.summary.avgCostUsd, 3)} sub="teto US$ 0,60 por cotação" gradient="from-amber-400 to-orange-500" />
      </div>

      <Card className="p-5">
        <CardHeader eyebrow="3 · Consumo por agente" title="Estimado a partir das chamadas registradas neste mês" />
        {view.month.by_agent.length === 0 ? <p className="text-sm text-slate-400">Sem chamadas registradas neste mês.</p> : (
          <table className="w-full text-left text-sm text-slate-200">
            <thead className="text-[11px] uppercase text-slate-500"><tr><th className="py-1">Agente / etapa</th><th>Chamadas</th><th>Tokens</th><th>Custo estimado</th></tr></thead>
            <tbody>{view.month.by_agent.map((a) => <tr key={a.endpoint} className="border-t border-white/5"><td className="py-1">{a.endpoint}</td><td>{a.requests}</td><td>{a.tokens.toLocaleString('pt-BR')}</td><td>{usd(a.estimated_usd, 4)}</td></tr>)}</tbody>
          </table>
        )}
      </Card>

      <Card className="p-5">
        <CardHeader eyebrow="Orçamento interno da Alizo" title="Super Agente: confirmado × não confirmado (empresa, mês)" />
        <p className="text-sm text-slate-200">Confirmado <b>{usd(overview.month.confirmed, 4)}</b> · reservas ativas {usd(overview.month.active, 4)} · não confirmadas {usd(overview.month.unconfirmed, 4)} · total contado {usd(overview.month.total, 4)} de {usd(overview.month.cap)}{overview.month.overrun > 0 ? ` · excesso sobre o previsto ${usd(overview.month.overrun, 4)}` : ''}</p>
        <p className="mt-1 text-xs text-slate-500">Estas são metas de custo da Alizo por empresa — não são o saldo da conta OpenAI.</p>
      </Card>

      <Card className="p-5">
        <CardHeader eyebrow="Consumo por cotação" title="Custo de cada cotação" />
        <table className="w-full text-left text-sm text-slate-200">
          <thead className="text-[11px] uppercase text-slate-500"><tr><th className="py-1">WO</th><th>Chamadas</th><th>Rodadas</th><th>Custo</th><th>% do teto</th></tr></thead>
          <tbody>{overview.jobs.map((j) => { const total = j.spent_usd + j.reserved_usd + j.unconfirmed_usd; const a = overview.appointments.find((x) => String(x.id) === j.appointment_id); return <tr key={j.id} className="border-t border-white/5"><td className="py-1">{String(a?.service_order_number ?? j.appointment_id.slice(0, 8))}</td><td>{j.ai_calls}</td><td>{j.rounds}</td><td>{usd(total, 4)}</td><td>{j.budget_usd ? `${((total / j.budget_usd) * 100).toFixed(0)}%` : '—'}</td></tr> })}</tbody>
        </table>
      </Card>

      <Card className="p-5">
        <CardHeader eyebrow="Status da integração" title="OpenAI" />
        <div className="flex flex-wrap gap-2">
          <StatusPill variant={view.integration.api_key_configured ? 'green' : 'red'}>Chave de inferência {view.integration.api_key_configured ? 'configurada' : 'ausente'}</StatusPill>
          <StatusPill variant={view.integration.admin_key_configured ? 'green' : 'amber'}>Chave administrativa (custos) {view.integration.admin_key_configured ? 'configurada' : 'ausente'}</StatusPill>
        </div>
        <p className="mt-2 text-xs text-slate-400">Última chamada registrada: {view.integration.last_usage_at ? new Date(view.integration.last_usage_at).toLocaleString('pt-BR') : 'nenhuma ainda'}. Credenciais administrativas ficam só no servidor.</p>
      </Card>
    </div>
  )
}
