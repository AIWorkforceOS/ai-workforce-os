import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui/dashboard-ui'
import { clientNameOf } from '@/lib/billing/by-client'
import { buildClientOverview, type OverviewOrder } from '@/lib/clients/overview'
import { PIPELINE_STAGES } from '@/lib/clients/pipeline'
import type { Unit } from '@/lib/types'

export const dynamic = 'force-dynamic'

/** Índice de clientes da unidade: um cartão por cliente com o funil resumido; clique abre o painel do cliente. */
export default async function ClientsIndexPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: unit } = await supabase.from('units').select('*').eq('id', id).single()
  if (!unit) notFound()
  const unitRow = unit as Unit

  type ApptRow = { id: string; service_order_status: string | null; quote_decision?: string | null; customer: { name: string | null; client_company: string | null } | null }
  const select = (cols: string) => supabase.from('appointments').select(cols).eq('unit_id', id).limit(5000)
  const cols = 'id, service_order_status, customer:customers(name, client_company)'
  let apptRes = await select(`${cols}, quote_decision`)
  if (apptRes.error) apptRes = await select(cols) // migration 103 ainda não aplicada
  const appts = (apptRes.data ?? []) as unknown as ApptRow[]

  const [{ data: recs }, { data: profiles }] = await Promise.all([
    supabase.from('service_records').select('appointment_id, invoice_id, payment_status, invoice:invoices(status)').eq('unit_id', id).not('appointment_id', 'is', null).limit(5000),
    supabase.from('client_company_profiles').select('name').eq('org_id', unitRow.org_id ?? ''),
  ])
  type RecRow = { appointment_id: string | null; invoice_id: string | null; payment_status: string | null; invoice: { status: string | null } | null }
  const recByAppt = new Map<string, RecRow>()
  for (const r of (recs ?? []) as unknown as RecRow[]) if (r.appointment_id) recByAppt.set(r.appointment_id, r)

  const orders: OverviewOrder[] = appts.map((a) => {
    const rec = recByAppt.get(a.id)
    return {
      clientName: a.customer?.client_company?.trim() ? clientNameOf(a.customer) : '',
      serviceOrderStatus: a.service_order_status,
      quoteDecision: a.quote_decision ?? null,
      invoiceId: rec?.invoice_id ?? null,
      invoiceStatus: rec?.invoice?.status ?? null,
      paid: rec?.payment_status === 'paid',
    }
  })
  const { clients, unlinked } = buildClientOverview(((profiles ?? []) as { name: string }[]).map((p) => p.name), orders)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow="clientes" title={`Clientes — ${unitRow.name}`} subtitle="Cada cliente com o andamento das ordens dele. Clique para abrir o painel do cliente." />
      {unlinked > 0 && <p className="text-xs text-amber-400">{unlinked} ordem(ns) ainda sem cliente vinculado — abra a ordem na Agenda e use “Cliente desta ordem”.</p>}
      {clients.length === 0 ? (
        <p className="text-sm text-slate-400">Nenhum cliente cadastrado. Cadastre em “Clientes Facility”.</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {clients.map((c) => (
            <Link key={c.name} href={`/dashboard/units/${id}/clientes/${encodeURIComponent(c.name)}`} className="flex flex-col gap-2 rounded-2xl p-4 transition-colors hover:bg-white/5" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-bold text-white">{c.name}</p>
                {c.awaitingApproval > 0 && (
                  <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: 'rgba(245,158,11,0.15)', color: '#fbbf24' }}>
                    {c.awaitingApproval} cotação(ões) a aprovar
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-500">{c.total} ordem(ns)</p>
              <div className="flex flex-wrap gap-1.5">
                {PIPELINE_STAGES.filter((s) => c.stages[s.key] > 0).map((s) => (
                  <span key={s.key} className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold text-slate-300" style={{ background: 'rgba(255,255,255,0.06)' }}>
                    {s.label.split(' (')[0]} · {c.stages[s.key]}
                  </span>
                ))}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
