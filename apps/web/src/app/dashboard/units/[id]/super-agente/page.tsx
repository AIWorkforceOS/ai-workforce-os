import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Card, CardHeader, KpiCard, PageHeader, StatusPill } from '@/components/ui/dashboard-ui'
import { PilotControls, RateCardForm } from '@/components/super-agente/admin-forms'
import { requireUnitAdmin } from '@/lib/quote-team/agent/admin-guard'
import { loadPilotOverview, pilotEligibleEmployees, pilotStateOf, type PilotDraft, type PilotJob } from '@/lib/quote-team/agent/admin-data'

export const dynamic = 'force-dynamic'

const STATE_LABEL: Record<string, string> = { processing: 'Em processamento', awaiting_info: 'Aguardando informações', awaiting_approval: 'Aguardando aprovação', approved: 'Aprovada', failed: 'Falha', budget_exhausted: 'Sem orçamento de IA', received: 'Recebida' }
const STATE_VARIANT: Record<string, 'green' | 'red' | 'amber' | 'blue' | 'slate'> = { processing: 'blue', awaiting_info: 'amber', awaiting_approval: 'amber', approved: 'green', failed: 'red', budget_exhausted: 'red', received: 'slate' }
const usd = (n: number | null | undefined) => (n == null ? '—' : `US$ ${n.toFixed(n < 1 ? 3 : 2)}`)
const mins = (s: number | null) => (s == null ? '—' : s < 90 ? `${Math.round(s)} s` : `${(s / 60).toFixed(1)} min`)

export default async function SuperAgentePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const guard = await requireUnitAdmin(id)
  if (!guard.ok) notFound()
  const { db, unit } = guard.ctx
  const o = await loadPilotOverview(db, unit)
  const { summary: s } = o
  const { data: rate } = await db.from('quote_rate_cards').select('*').eq('org_id', unit.org_id).eq('is_active', true).or(`unit_id.eq.${unit.id},unit_id.is.null`).order('effective_from', { ascending: false }).limit(1).maybeSingle()
  const { data: limitsData } = await db.from('quote_org_limits').select('pilot_max_quotes').eq('org_id', unit.org_id).maybeSingle()
  const limitsRow = limitsData as { pilot_max_quotes: number | null } | null
  const apptById = new Map(o.appointments.map((a) => [String(a.id), a]))
  const empById = new Map(o.employees.map((e) => [String(e.id), e]))
  const latest = new Map<string, PilotDraft>()
  for (const d of o.drafts) {
    const cur = latest.get(d.appointment_id)
    if (!cur || d.version > cur.version) latest.set(d.appointment_id, d)
  }
  const reviewed = new Map(o.reviews.map((r) => [r.appointment_id, r]))
  const accuracyBase = s.verdicts.correct + s.verdicts.partial + s.verdicts.incorrect

  return (
    <div className="flex flex-col gap-6 pb-10">
      <PageHeader eyebrow="Super Agente de Cotações" title="Super Agente — Piloto MAWI" subtitle={`${unit.name} · revisão humana obrigatória · nada é enviado automaticamente ao cliente`} action={<Link href={`/dashboard/units/${id}/consumo-ia`} className="rounded-xl px-4 py-2 text-sm font-bold text-cyan-200" style={{ background: 'rgba(6,182,212,0.12)', border: '1px solid rgba(6,182,212,0.35)' }}>Consumo de IA</Link>} />

      {s.alerts.length > 0 && (
        <Card className="p-4">
          {s.alerts.map((a, i) => <p key={i} className="text-sm text-amber-200">⚠ {a}</p>)}
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Cotações recebidas" value={s.total} sub="no piloto" />
        <KpiCard label="Em processamento" value={s.byState.processing} sub={`${s.byState.awaiting_info} aguardando informações`} gradient="from-blue-400 to-indigo-500" />
        <KpiCard label="Aguardando aprovação" value={s.byState.awaiting_approval} sub={`${s.byState.approved} aprovadas`} gradient="from-amber-400 to-orange-500" />
        <KpiCard label="Falhas" value={s.byState.failed + s.byState.budget_exhausted} sub="inclui sem orçamento de IA" gradient="from-rose-400 to-red-500" />
        <KpiCard label="Tempo médio" value={mins(s.avgProcessingSeconds)} sub="até a 1ª versão" />
        <KpiCard label="Custo médio por cotação" value={usd(s.avgCostUsd)} sub={`máx. ${usd(s.maxCostUsd)} · teto US$ 0,60`} gradient="from-emerald-400 to-teal-500" />
        <KpiCard label="Consumo do mês" value={usd(o.month.total)} sub={`limite US$ ${o.month.cap.toFixed(2)} por empresa`} gradient="from-violet-400 to-purple-500" />
        <KpiCard label="Materiais com preço pendente" value={s.pendingPriceItems} sub="em versões ainda não aprovadas" gradient="from-amber-400 to-orange-500" />
        <KpiCard label="Diagnósticos corretos" value={s.verdicts.correct} sub={accuracyBase ? `${((s.verdicts.correct / accuracyBase) * 100).toFixed(0)}% dos avaliados` : 'ainda sem avaliações'} />
        <KpiCard label="Parciais / incorretos" value={`${s.verdicts.partial} / ${s.verdicts.incorrect}`} sub={`${s.verdicts.pending} aprovadas sem avaliação`} />
        <KpiCard label="Perguntas por cotação" value={s.questionsPerQuote == null ? '—' : s.questionsPerQuote.toFixed(1)} sub={`${s.revisions} revisões no total`} />
        <KpiCard label="Horas: ajuste médio" value={s.hoursSuggestedVsFinal.avgDeltaHours == null ? '—' : `${s.hoursSuggestedVsFinal.avgDeltaHours >= 0 ? '+' : ''}${s.hoursSuggestedVsFinal.avgDeltaHours.toFixed(2)} h`} sub={`${s.hoursSuggestedVsFinal.quotes} cotações comparadas`} />
      </div>

      <Card className="p-5">
        <CardHeader eyebrow="Piloto" title="Controle (liga/desliga imediato)" />
        <PilotControls unitId={id} mode={unit.quote_ai_team_mode} limits={{ monthly_cap_usd: o.month.cap, max_quotes: limitsRow?.pilot_max_quotes ?? null }} employees={pilotEligibleEmployees(o.employees)} />
      </Card>

      <Card className="p-5">
        <CardHeader eyebrow="Cotações" title="Todas as cotações do piloto" />
        {o.jobs.length === 0 ? (
          <p className="text-sm text-slate-400">Nenhuma cotação com IA ainda. Quando um técnico autorizado tocar em &quot;Gerar Cotação com IA&quot;, ela aparece aqui.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-200">
              <thead className="text-[11px] uppercase text-slate-500">
                <tr><th className="py-2">WO</th><th>Local</th><th>Técnico</th><th>Estado</th><th>Versão</th><th>Revisões</th><th>Custo</th><th>Avaliação</th></tr>
              </thead>
              <tbody>
                {o.jobs.map((j: PilotJob) => {
                  const a = apptById.get(j.appointment_id)
                  const d = latest.get(j.appointment_id) ?? null
                  const state = pilotStateOf(j, d)
                  const v = reviewed.get(j.appointment_id)?.diagnosis_verdict
                  return (
                    <tr key={j.id} className="border-t border-white/5">
                      <td className="py-2"><Link className="font-bold text-cyan-300 underline" href={`/dashboard/units/${id}/super-agente/${j.appointment_id}`}>{String(a?.service_order_number ?? j.appointment_id.slice(0, 8))}</Link></td>
                      <td>{String(a?.service_order_location_name ?? '—')}</td>
                      <td>{String(empById.get(String(a?.employee_id))?.name ?? '—')}</td>
                      <td><StatusPill variant={STATE_VARIANT[state] ?? 'slate'}>{STATE_LABEL[state]}</StatusPill></td>
                      <td>{d ? `v${d.version}` : '—'}</td>
                      <td>{Math.max(0, j.rounds - 1)}</td>
                      <td>{usd(j.spent_usd + j.reserved_usd + j.unconfirmed_usd)}</td>
                      <td>{v === 'correct' ? 'Correto' : v === 'partial' ? 'Parcial' : v === 'incorrect' ? 'Incorreto' : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="p-5">
        <CardHeader eyebrow="Regra comercial (admin)" title="Valores por hora-homem e regras opcionais" />
        <RateCardForm unitId={id} initial={(rate as Record<string, number | null> | null) ?? null} />
      </Card>
    </div>
  )
}
