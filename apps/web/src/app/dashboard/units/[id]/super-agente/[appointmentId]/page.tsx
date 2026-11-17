import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Card, CardHeader, PageHeader, StatusPill } from '@/components/ui/dashboard-ui'
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
  const { data: apptRow } = await db.from('appointments').select('id, starts_at, ends_at, status, notes, address, service_order_number, service_order_client_po, service_order_location_name, service_order_summary_pt, service_order_scope_en, service_order_completion_summary, service_order_status, service_order_file_url, service_order_file_name, service_order_part_purchase_link, service_order_material_description, service_order_material_value, service_order_hours_needed, service_order_photos, service_order_signed_by, service_order_signed_at, service_order_signature_url, trip_started_at, trip_start_lat, trip_start_lng, trip_start_accuracy_m, checked_in_at, checkin_lat, checkin_lng, checkin_accuracy_m, work_ended_at, work_end_lat, work_end_lng, work_end_accuracy_m, employee_id, customer:customers(name, client_company), employee:employees(name), service:services(name)').eq('id', appointmentId).eq('unit_id', unit.id).maybeSingle()
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
  const photos = (Array.isArray(appt.service_order_photos) ? appt.service_order_photos : []) as { url: string; kind?: string }[]
  const customer = appt.customer as { name?: string; client_company?: string | null } | null
  const employee = appt.employee as { name?: string } | null
  const service = appt.service as { name?: string } | null
  const orderStatus = String(appt.service_order_status ?? (appt.status === 'completed' ? 'completed' : 'pending'))
  const statusLabel = orderStatus === 'completed' ? 'Finalizada' : orderStatus === 'quote' ? 'Cotação' : 'Não atendida'
  const statusVariant = orderStatus === 'completed' ? 'green' : orderStatus === 'quote' ? 'purple' : 'amber'
  const elapsedMinutes = Math.max(0, Math.round((new Date(String(appt.ends_at)).getTime() - new Date(String(appt.starts_at)).getTime()) / 60000))
  const eventTime = (value: unknown) => value ? new Date(String(value)).toLocaleString('pt-BR') : 'Não registrado'
  const durationBetween = (start: unknown, end: unknown) => {
    if (!start || !end) return 'Não registrado'
    const minutes = Math.max(0, Math.round((new Date(String(end)).getTime() - new Date(String(start)).getTime()) / 60000))
    return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}min` : `${minutes}min`
  }
  const mapLink = (lat: unknown, lng: unknown) => typeof lat === 'number' && typeof lng === 'number' ? `https://www.google.com/maps?q=${lat},${lng}` : null
  const tripMap = mapLink(appt.trip_start_lat, appt.trip_start_lng)
  const checkinMap = mapLink(appt.checkin_lat, appt.checkin_lng)
  const finishMap = mapLink(appt.work_end_lat, appt.work_end_lng)

  return (
    <div className="flex flex-col gap-6 pb-10">
      <PageHeader eyebrow="Histórico operacional" title={appt.service_order_number ? `WO ${String(appt.service_order_number)}` : String(service?.name ?? 'Atendimento')} subtitle={`${String(customer?.client_company || customer?.name || 'Cliente não informado')} · ${String(appt.service_order_location_name ?? appt.address ?? 'Local não informado')}`} action={<Link href={`/dashboard/units/${id}/super-agente`} className="text-sm font-bold text-cyan-300 underline">← Voltar ao painel</Link>} />

      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <StatusPill variant={statusVariant}>{statusLabel}</StatusPill>
            <p className="mt-3 text-sm text-slate-200"><b>Profissional:</b> {employee?.name ?? 'Não definido'} · <b>Data:</b> {new Date(String(appt.starts_at)).toLocaleString('pt-BR')}</p>
            <p className="text-sm text-slate-200"><b>PO:</b> {String(appt.service_order_client_po ?? '—')} · <b>Tempo reservado:</b> {elapsedMinutes >= 60 ? `${Math.floor(elapsedMinutes / 60)}h ${elapsedMinutes % 60}min` : `${elapsedMinutes}min`} · <b>Horas informadas pelo técnico:</b> {String(appt.service_order_hours_needed ?? '—')}</p>
          </div>
          {appt.service_order_file_url ? <a className="rounded-xl bg-white/5 px-4 py-2 text-sm font-bold text-cyan-300" href={String(appt.service_order_file_url)} target="_blank" rel="noreferrer">Abrir ordem original</a> : null}
        </div>
      </Card>

      <Card className="p-5">
        <CardHeader eyebrow="Execução em campo" title="Deslocamento, GPS e tempo de trabalho" />
        <div className="grid gap-3 md:grid-cols-3">
          {[
            { label: 'Início da viagem', at: appt.trip_started_at, map: tripMap, accuracy: appt.trip_start_accuracy_m },
            { label: 'Check-in no local', at: appt.checked_in_at, map: checkinMap, accuracy: appt.checkin_accuracy_m },
            { label: 'Fim do serviço', at: appt.work_ended_at, map: finishMap, accuracy: appt.work_end_accuracy_m },
          ].map((event) => <div key={event.label} className="rounded-xl bg-white/5 p-4"><p className="text-xs font-black uppercase tracking-wide text-slate-500">{event.label}</p><p className="mt-1 text-sm font-bold text-white">{eventTime(event.at)}</p>{event.map ? <a href={event.map} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs font-bold text-cyan-300 underline">Abrir localização no mapa{typeof event.accuracy === 'number' ? ` · precisão ${Math.round(event.accuracy)} m` : ''}</a> : <p className="mt-2 text-xs text-slate-500">Localização não registrada.</p>}</div>)}
        </div>
        <div className="mt-4 flex flex-wrap gap-3 text-sm text-slate-200">
          <span className="rounded-lg bg-white/5 px-3 py-2"><b>Tempo de deslocamento:</b> {durationBetween(appt.trip_started_at, appt.checked_in_at)}</span>
          <span className="rounded-lg bg-white/5 px-3 py-2"><b>Tempo real em serviço:</b> {durationBetween(appt.checked_in_at, appt.work_ended_at)}</span>
          <span className="rounded-lg bg-white/5 px-3 py-2"><b>Total em campo:</b> {durationBetween(appt.trip_started_at, appt.work_ended_at)}</span>
        </div>
      </Card>

      <Card className="p-5">
        <CardHeader eyebrow="Resumo rápido" title={orderStatus === 'completed' ? 'O que foi executado' : 'O que precisa ser feito'} />
        <p className="whitespace-pre-wrap text-sm text-slate-200">{String(orderStatus === 'completed' ? appt.service_order_completion_summary ?? 'Ordem antiga sem resumo de conclusão.' : appt.service_order_summary_pt ?? appt.notes ?? 'Sem descrição registrada.')}</p>
      </Card>

      <Card className="p-5">
        <CardHeader eyebrow="Escopo e materiais" title="Descrição completa" />
        <p className="whitespace-pre-wrap text-sm text-slate-200">{String(appt.service_order_scope_en ?? appt.service_order_summary_pt ?? appt.notes ?? '—')}</p>
        {appt.service_order_material_description ? <p className="mt-3 whitespace-pre-wrap text-sm text-slate-300"><b>Materiais/peça:</b> {String(appt.service_order_material_description)}</p> : null}
        {appt.service_order_material_value != null ? <p className="mt-1 text-sm text-slate-300"><b>Valor estimado:</b> US$ {Number(appt.service_order_material_value).toFixed(2)}</p> : null}
        {appt.service_order_part_purchase_link ? <a className="mt-2 inline-block text-sm font-bold text-cyan-300 underline" href={String(appt.service_order_part_purchase_link)} target="_blank" rel="noreferrer">Abrir link de compra da peça</a> : null}
      </Card>

      <Card className="p-5">
        <CardHeader eyebrow="Evidências" title={`Fotos e arquivos (${photos.length})`} />
        {photos.length === 0 ? <p className="text-sm text-slate-400">Nenhuma foto ou vídeo foi anexado.</p> : <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{photos.map((photo, index) => {
          const isVideo = photo.kind === 'video' || /\.(mp4|mov|webm)(\?|$)/i.test(photo.url)
          return <a key={`${photo.url}-${index}`} href={photo.url} target="_blank" rel="noreferrer" className="overflow-hidden rounded-xl bg-white/5">{isVideo ? <video src={photo.url} controls preload="metadata" className="h-36 w-full object-cover" /> : <img src={photo.url} alt={`Evidência ${index + 1}`} className="h-36 w-full object-cover" />}<p className="px-3 py-2 text-xs font-bold text-slate-300">{isVideo ? 'Vídeo' : photo.kind ?? 'serviço'} · abrir</p></a>
        })}</div>}
      </Card>

      <Card className="p-5">
        <CardHeader eyebrow="Confirmação do cliente" title="Assinatura e sign-off" />
        {appt.service_order_signature_url ? <div className="flex flex-wrap items-center gap-4"><img src={String(appt.service_order_signature_url)} alt="Assinatura do cliente" className="max-h-28 rounded-xl bg-white p-2" /><p className="text-sm text-slate-200">Assinado por <b>{String(appt.service_order_signed_by ?? 'cliente')}</b>{appt.service_order_signed_at ? ` em ${new Date(String(appt.service_order_signed_at)).toLocaleString('pt-BR')}` : ''}.</p></div> : <p className="text-sm text-slate-400">Ainda não há assinatura registrada.</p>}
        <div className="mt-4 flex flex-wrap gap-3">
          <a href={`/api/units/${id}/appointments/${appointmentId}/service-order/pdf`} className="rounded-xl bg-cyan-500/15 px-4 py-2 text-sm font-bold text-cyan-200">Baixar Sign Off completo (PDF)</a>
          {photos.length > 0 && <a href={`/api/units/${id}/appointments/${appointmentId}/service-order/pdf?report=photos`} className="rounded-xl bg-white/5 px-4 py-2 text-sm font-bold text-slate-200">Baixar relatório fotográfico (PDF)</a>}
        </div>
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
