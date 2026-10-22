import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui/dashboard-ui'
import { normalizeClientName } from '@/lib/client-profiles/profile'
import { QuoteDecisionButtons } from '@/components/clients/quote-decision-buttons'
import { groupByStage, PIPELINE_STAGES, type PipelineInput } from '@/lib/clients/pipeline'
import type { Unit } from '@/lib/types'

export const dynamic = 'force-dynamic'

type OrderRow = PipelineInput & {
  id: string
  startsAt: string
  orderNumber: string | null
  location: string | null
  employee: string | null
}

/** Painel do cliente: todas as ordens dele em funil (agendada → cotação → concluída → faturada → recebida). */
export default async function ClientPanelPage({ params }: { params: Promise<{ id: string; client: string }> }) {
  const { id, client: raw } = await params
  const clientName = normalizeClientName(decodeURIComponent(raw))
  if (!clientName) notFound()
  const supabase = await createClient()
  const { data: unit } = await supabase.from('units').select('*').eq('id', id).single()
  if (!unit) notFound()
  const unitRow = unit as Unit

  const { data: customers } = await supabase.from('customers').select('id').eq('unit_id', id).ilike('client_company', clientName).limit(500)
  const customerIds = ((customers ?? []) as { id: string }[]).map((c) => c.id)

  type ApptRow = { id: string; starts_at: string; service_order_status: string | null; service_order_number: string | null; service_order_location_name: string | null; quote_decision?: string | null; employee: { name: string | null } | null }
  let appts: ApptRow[] = []
  if (customerIds.length > 0) {
    const base = (cols: string) => supabase.from('appointments').select(cols).eq('unit_id', id).in('customer_id', customerIds).order('starts_at', { ascending: false }).limit(300)
    const cols = 'id, starts_at, service_order_status, service_order_number, service_order_location_name, employee:employees(name)'
    let result = await base(`${cols}, quote_decision`)
    if (result.error) result = await base(cols) // migration 103 ainda não aplicada
    appts = (result.data ?? []) as unknown as ApptRow[]
  }

  type RecRow = { appointment_id: string | null; invoice_id: string | null; payment_status: string | null; invoice: { status: string | null } | null }
  const recByAppt = new Map<string, RecRow>()
  if (appts.length > 0) {
    const { data } = await supabase.from('service_records').select('appointment_id, invoice_id, payment_status, invoice:invoices(status)').in('appointment_id', appts.map((a) => a.id))
    for (const r of (data ?? []) as unknown as RecRow[]) if (r.appointment_id) recByAppt.set(r.appointment_id, r)
  }

  const orders: OrderRow[] = appts.map((a) => {
    const rec = recByAppt.get(a.id)
    return {
      id: a.id,
      startsAt: a.starts_at,
      orderNumber: a.service_order_number,
      location: a.service_order_location_name,
      employee: a.employee?.name ?? null,
      serviceOrderStatus: a.service_order_status,
      quoteDecision: a.quote_decision ?? null,
      invoiceId: rec?.invoice_id ?? null,
      invoiceStatus: rec?.invoice?.status ?? null,
      paid: rec?.payment_status === 'paid',
    }
  })
  const groups = groupByStage(orders)
  const fmt = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { timeZone: unitRow.timezone })

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="cliente"
        title={clientName}
        subtitle={`Todas as ordens de ${clientName} em ${unitRow.name}, da agenda ao recebimento.`}
        action={
          <div className="flex flex-wrap gap-2 text-xs font-bold">
            <Link href={`/dashboard/units/${id}/agenda/calendario`} className="rounded-xl px-3 py-2 text-slate-300 hover:bg-white/5" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
              Agenda
            </Link>
            <Link href={`/dashboard/units/${id}/faturamento`} className="rounded-xl px-3 py-2 text-slate-300 hover:bg-white/5" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
              Faturamento
            </Link>
          </div>
        }
      />
      {orders.length === 0 ? (
        <p className="text-sm text-slate-400">Nenhuma ordem vinculada a este cliente ainda. Abra uma ordem na Agenda e use “Cliente desta ordem” para vincular.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
          {PIPELINE_STAGES.map((stage) => (
            <section key={stage.key} className="flex flex-col gap-2 rounded-2xl p-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
              <h2 className="text-xs font-bold uppercase tracking-wide text-slate-300">
                {stage.label} <span className="text-slate-500">({groups[stage.key].length})</span>
              </h2>
              {groups[stage.key].map((o) => (
                <div key={o.id} className="rounded-xl p-2.5 text-xs text-slate-200" style={{ background: 'rgba(255,255,255,0.04)' }}>
                  <p className="font-bold">{o.orderNumber ? `PO ${o.orderNumber}` : 'Sem nº de ordem'}</p>
                  <p className="text-slate-400">{o.location ?? 'Local não informado'}</p>
                  <p className="text-slate-500">
                    {fmt(o.startsAt)}
                    {o.employee ? ` · ${o.employee}` : ''}
                  </p>
                  {(stage.key === 'cotacao' || stage.key === 'aprovada') && <QuoteDecisionButtons unitId={id} appointmentId={o.id} decision={o.quoteDecision ?? null} />}
                </div>
              ))}
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
