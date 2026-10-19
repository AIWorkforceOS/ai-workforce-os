import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Card, CardHeader, PageHeader } from '@/components/ui/dashboard-ui'
import { AdminRevisionForm, ReviewForm } from '@/components/super-agente/admin-forms'
import { requireUnitAdmin } from '@/lib/quote-team/agent/admin-guard'
import { listQuoteMessages } from '@/lib/quote-team/agent/messages'
import { SupabaseJobStore } from '@/lib/quote-team/job-store'
import { formatUsdFromMicros } from '@/lib/quote-team/visibility'

export const dynamic = 'force-dynamic'
type Row = Record<string, unknown>
const usd = (n: number) => `US$ ${n.toFixed(n < 1 ? 4 : 2)}`

export default async function SuperAgenteDetailPage({ params }: { params: Promise<{ id: string; appointmentId: string }> }) {
  const { id, appointmentId } = await params
  const guard = await requireUnitAdmin(id)
  if (!guard.ok) notFound()
  const { db, unit } = guard.ctx
  const { data: apptRow } = await db.from('appointments').select('id, service_order_number, service_order_client_po, service_order_location_name, address, service_order_material_description, employee_id').eq('id', appointmentId).eq('unit_id', unit.id).maybeSingle()
  const appt = apptRow as Row | null
  if (!appt) notFound()
  const job = await new SupabaseJobStore(db).findByAppointment(appointmentId)
  const { data: draftRows } = await db.from('quote_drafts').select('*').eq('appointment_id', appointmentId).order('version', { ascending: false })
  const drafts = (draftRows as Row[] | null) ?? []
  const current = drafts[0] ?? null
  const [items, labor, commercial, events, messages, review] = await Promise.all([
    current ? db.from('quote_items').select('*').eq('draft_id', String(current.id)).order('position', { ascending: true }) : Promise.resolve({ data: [] }),
    current ? db.from('quote_labor_plan').select('*').eq('draft_id', String(current.id)).maybeSingle() : Promise.resolve({ data: null }),
    current ? db.from('quote_commercial').select('*').eq('draft_id', String(current.id)).maybeSingle() : Promise.resolve({ data: null }),
    db.from('quote_events').select('*').eq('appointment_id', appointmentId).order('created_at', { ascending: true }),
    listQuoteMessages(db, appointmentId),
    db.from('quote_pilot_reviews').select('*').eq('appointment_id', appointmentId).maybeSingle(),
  ])
  const itemRows = (items.data as Row[] | null) ?? []
  const laborRow = labor.data as Row | null
  const comm = commercial.data as Row | null
  const aiOriginal = (current?.ai_original ?? null) as { labor?: { man_hours?: number }; materials?: { items?: unknown[] } } | null
  const suggested = aiOriginal?.labor?.man_hours ?? null
  const edited = (current?.edited_fields as string[] | null) ?? []
  const m = (v: unknown) => formatUsdFromMicros(v as number | null)

  return (
    <div className="flex flex-col gap-6 pb-10">
      <PageHeader eyebrow="Super Agente — Piloto MAWI" title={`WO ${String(appt.service_order_number ?? appointmentId.slice(0, 8))}`} subtitle={`${String(appt.service_order_location_name ?? '')} · PO ${String(appt.service_order_client_po ?? '—')}`} action={<Link href={`/dashboard/units/${id}/super-agente`} className="text-sm font-bold text-cyan-300 underline">← Voltar ao painel</Link>} />

      <Card className="p-5">
        <CardHeader eyebrow="Entrada do técnico" title="Descrição original" />
        <p className="whitespace-pre-wrap text-sm text-slate-200">{String(appt.service_order_material_description ?? '—')}</p>
      </Card>

      <Card className="p-5">
        <CardHeader eyebrow="Processamento" title="Andamento e custo de IA" />
        {job ? (
          <p className="text-sm text-slate-200">Estado: <b>{job.status}</b> (etapa {job.stage}) · rodadas {job.rounds} · chamadas de IA {job.ai_calls} · custo confirmado <b>{usd(Number(job.spent_usd))}</b> · reservas ativas {usd(Number(job.reserved_usd))} · não confirmadas {usd(Number(job.unconfirmed_usd))} · teto {usd(Number(job.budget_usd))}{job.error_code ? ` · erro: ${job.error_code}` : ''}</p>
        ) : <p className="text-sm text-slate-400">A análise ainda não foi iniciada.</p>}
      </Card>

      {current && (
        <Card className="p-5">
          <CardHeader eyebrow={`Versão ${String(current.version)} · ${String(current.status)}`} title="Cotação técnica (visão do administrador)" />
          <p className="mb-2 text-xs text-slate-400">Verificação técnica: {String(current.technical_check)} · editado pelo técnico: {edited.length ? edited.join(', ') : 'não'} · versões: {drafts.map((d) => `v${String(d.version)} (${String(d.status)})`).join(', ')}</p>
          <p className="mb-3 text-sm text-slate-200">{String((current.diagnosis as { summary_pt?: string } | null)?.summary_pt ?? current.tech_text_pt ?? '')}</p>
          <table className="w-full text-left text-sm text-slate-200">
            <thead className="text-[11px] uppercase text-slate-500"><tr><th className="py-1">Material</th><th>Qtd</th><th>Preço compra</th><th>Fornecedor</th><th>Status</th></tr></thead>
            <tbody>
              {itemRows.map((it) => (
                <tr key={String(it.id)} className="border-t border-white/5">
                  <td className="py-1">{String(it.name_en)}</td>
                  <td>{String(it.quantity)} {String(it.unit)}</td>
                  <td>{m(it.unit_price_micros) ? `US$ ${m(it.unit_price_micros)}` : 'pendente'}</td>
                  <td>{it.product_url ? <a className="text-cyan-300 underline" href={String(it.product_url)} target="_blank" rel="noreferrer">{String(it.supplier ?? 'link')}</a> : String(it.supplier ?? '—')}</td>
                  <td>{String(it.price_status)}{it.edited_by_technician ? ' · editado' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-sm text-slate-200">Materiais: {m(current.materials_total_micros) ? `US$ ${m(current.materials_total_micros)}` : 'pendente'} ({String(current.pending_price_count)} sem preço)</p>
          {laborRow && <p className="text-sm text-slate-200">Mão de obra: {String(laborRow.technicians)} técnico(s) × {String(laborRow.service_hours)} h = <b>{String(laborRow.man_hours)} h-homem</b>{laborRow.edited_by_technician ? ' (ajustado)' : ''}</p>}
          <div className="mt-3 flex gap-3">
            <a className="text-sm font-bold text-cyan-300 underline" href={`/api/units/${id}/appointments/${appointmentId}/quote-agent/pdf`}>PDF técnico (sem preços)</a>
            <a className="text-sm font-bold text-cyan-300 underline" href={`/api/units/${id}/appointments/${appointmentId}/quote-agent/pdf?prices=1`}>PDF técnico com preços de compra (autorizado)</a>
          </div>
        </Card>
      )}

      {comm && (
        <Card className="p-5">
          <CardHeader eyebrow="SOMENTE ADMIN" title="Camada comercial (nunca visível ao técnico)" />
          <p className="text-sm text-slate-200">Mão de obra cobrada: <b>US$ {m(comm.billed_labor_micros) ?? '—'}</b> · custo interno do técnico: US$ {m(comm.internal_labor_cost_micros) ?? '—'} · markup de materiais: {m(comm.materials_markup_micros) ? `US$ ${m(comm.materials_markup_micros)}` : 'não configurado'} · impostos: {m(comm.taxes_micros) ? `US$ ${m(comm.taxes_micros)}` : 'não configurado'}</p>
          <p className="text-sm text-slate-200">Total comercial: <b>US$ {m(comm.commercial_total_micros) ?? '—'}</b> · margem: US$ {m(comm.margin_micros) ?? '—'}</p>
          {comm.notes ? <p className="text-xs text-amber-200">{String(comm.notes)}</p> : null}
        </Card>
      )}

      <Card className="p-5">
        <CardHeader eyebrow="Histórico completo" title="Conversa técnico ↔ agente" />
        {messages.length === 0 ? <p className="text-sm text-slate-400">Sem mensagens.</p> : (
          <ul className="flex flex-col gap-2">
            {messages.map((x) => (
              <li key={x.id} className="rounded-lg bg-white/5 px-3 py-2 text-xs text-slate-200">
                <b>{x.role}</b> · {x.kind} · rodada {x.round} · {new Date(x.created_at).toLocaleString('pt-BR')}
                {x.body ? <p className="whitespace-pre-wrap">{x.body}</p> : null}
                {x.media.length > 0 ? <p className="text-slate-400">{x.media.length} foto(s)</p> : null}
              </li>
            ))}
          </ul>
        )}
        <details className="mt-3"><summary className="cursor-pointer text-xs font-bold text-slate-400">Eventos ({((events.data as Row[] | null) ?? []).length})</summary>
          <ul className="mt-2 text-xs text-slate-400">{((events.data as Row[] | null) ?? []).map((e) => <li key={String(e.id)}>{new Date(String(e.created_at)).toLocaleString('pt-BR')} · {String(e.type)} · {String(e.actor_role ?? 'system')} · {JSON.stringify(e.diff)}</li>)}</ul>
        </details>
      </Card>

      <Card className="p-5">
        <CardHeader eyebrow="Administrador" title="Solicitar correção à IA" />
        <AdminRevisionForm unitId={id} appointmentId={appointmentId} disabled={!job || job.status === 'queued' || job.status === 'running' || job.status === 'budget_exhausted'} />
      </Card>

      <Card className="p-5">
        <CardHeader eyebrow="Piloto" title="Avaliação humana desta cotação" />
        <ReviewForm unitId={id} appointmentId={appointmentId} initial={(review.data as Row | null) as never} suggestedHours={suggested} />
      </Card>
    </div>
  )
}
