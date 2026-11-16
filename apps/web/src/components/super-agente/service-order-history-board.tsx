import Link from 'next/link'
import { Camera, CheckCircle2, Clock3, FileText, PenTool, Receipt, Search } from 'lucide-react'
import { Card, KpiCard, StatusPill } from '@/components/ui/dashboard-ui'

export type AdminOrderHistoryRow = {
  id: string
  starts_at: string
  status: string
  notes: string | null
  address: string | null
  source: string | null
  service_order_number: string | null
  service_order_status: 'pending' | 'completed' | 'quote'
  service_order_location_name: string | null
  service_order_summary_pt: string | null
  service_order_completion_summary: string | null
  service_order_material_description: string | null
  service_order_signed_by: string | null
  service_order_signature_url: string | null
  service_order_photos: { url: string; kind?: string }[] | null
  customer: { name: string; client_company: string | null } | null
  employee: { name: string } | null
  service: { name: string } | null
}

type Filter = 'all' | 'pending' | 'quote' | 'completed'
type State = Exclude<Filter, 'all'>
type Kind = 'orders' | 'services'

const label = { pending: 'Não atendidas', quote: 'Cotações', completed: 'Finalizadas' }
const variant = { pending: 'amber', quote: 'purple', completed: 'green' } as const

function isWorkOrder(row: AdminOrderHistoryRow): boolean {
  return Boolean(row.service_order_number || row.source?.includes('service_order'))
}

function effectiveStatus(row: AdminOrderHistoryRow): State {
  if (isWorkOrder(row)) return row.service_order_status
  return row.status === 'completed' ? 'completed' : 'pending'
}

function summary(row: AdminOrderHistoryRow): string {
  if (effectiveStatus(row) === 'completed') {
    return row.service_order_completion_summary?.trim() || 'Atendimento finalizado. O resumo da execução não foi registrado nas ordens antigas.'
  }
  if (effectiveStatus(row) === 'quote') {
    return row.service_order_material_description?.trim() || row.service_order_summary_pt?.trim() || 'Cotação aguardando definição dos materiais.'
  }
  return row.service_order_summary_pt?.trim() || row.notes?.trim() || 'Atendimento aguardando execução.'
}

export function ServiceOrderHistoryBoard({ unitId, rows, filter, kind, query }: { unitId: string; rows: AdminOrderHistoryRow[]; filter: Filter; kind: Kind; query: string }) {
  const byKind = rows.filter((row) => (kind === 'orders' ? isWorkOrder(row) : !isWorkOrder(row)))
  const counts = {
    pending: byKind.filter((row) => effectiveStatus(row) === 'pending').length,
    quote: byKind.filter((row) => effectiveStatus(row) === 'quote').length,
    completed: byKind.filter((row) => effectiveStatus(row) === 'completed').length,
  }
  const needle = query.trim().toLowerCase()
  const visible = byKind.filter((row) => {
    if (filter !== 'all' && effectiveStatus(row) !== filter) return false
    if (!needle) return true
    return [row.service_order_number, row.service_order_location_name, row.address, row.customer?.name, row.customer?.client_company, row.employee?.name, row.service?.name, summary(row)]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(needle))
  })
  const href = (next: Partial<{ filter: Filter; kind: Kind; q: string }>) => {
    const p = new URLSearchParams({ tab: 'orders', kind, status: filter })
    if (query) p.set('q', query)
    if (next.kind) p.set('kind', next.kind)
    if (next.filter) p.set('status', next.filter)
    if (next.q !== undefined) {
      if (next.q) p.set('q', next.q)
      else p.delete('q')
    }
    return `?${p.toString()}`
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap gap-2">
        <Link href={href({ kind: 'orders', filter: 'all' })} className={`rounded-xl px-4 py-2 text-sm font-bold ${kind === 'orders' ? 'bg-cyan-500/20 text-cyan-200' : 'bg-white/5 text-slate-300'}`}>Ordens de serviço</Link>
        <Link href={href({ kind: 'services', filter: 'all' })} className={`rounded-xl px-4 py-2 text-sm font-bold ${kind === 'services' ? 'bg-cyan-500/20 text-cyan-200' : 'bg-white/5 text-slate-300'}`}>Atendimentos e limpeza</Link>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiCard label="Não atendidas" value={counts.pending} sub="aguardando execução" gradient="from-amber-400 to-orange-500" />
        <KpiCard label="Cotações" value={counts.quote} sub="materiais ou aprovação" gradient="from-violet-400 to-purple-500" />
        <KpiCard label="Finalizadas" value={counts.completed} sub="histórico disponível" gradient="from-emerald-400 to-teal-500" />
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          {(['all', 'pending', 'quote', 'completed'] as Filter[]).map((item) => (
            <Link key={item} href={href({ filter: item })} className={`rounded-lg px-3 py-1.5 text-xs font-bold ${filter === item ? 'bg-cyan-500/20 text-cyan-200' : 'bg-white/5 text-slate-400'}`}>
              {item === 'all' ? 'Todas' : label[item]}
            </Link>
          ))}
          <form className="ml-auto flex min-w-[260px] items-center gap-2" method="get">
            <input type="hidden" name="tab" value="orders" /><input type="hidden" name="kind" value={kind} /><input type="hidden" name="status" value={filter} />
            <div className="relative flex-1"><Search className="absolute left-3 top-2.5 text-slate-500" size={14} /><input name="q" defaultValue={query} placeholder="WO, cliente, local ou técnico" className="w-full rounded-xl bg-white/5 py-2 pl-9 pr-3 text-sm text-white outline-none" /></div>
            <button className="rounded-xl bg-cyan-500/20 px-3 py-2 text-xs font-bold text-cyan-200">Buscar</button>
          </form>
        </div>
      </Card>

      {visible.length === 0 ? <Card className="p-8 text-center text-sm text-slate-400">Nenhum registro encontrado neste filtro.</Card> : (
        <div className="grid gap-3">
          {visible.map((row) => {
            const state = effectiveStatus(row)
            const photos = row.service_order_photos ?? []
            const client = row.customer?.client_company || row.customer?.name || 'Cliente não informado'
            return (
              <Link key={row.id} href={`/dashboard/units/${unitId}/super-agente/${row.id}`} className="block">
                <Card className="p-4 transition hover:border-cyan-400/30 hover:bg-cyan-500/[0.03]">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <StatusPill variant={variant[state] ?? 'slate'}>{label[state] ?? state}</StatusPill>
                        <span className="font-black text-white">{isWorkOrder(row) ? `WO ${row.service_order_number ?? row.id.slice(0, 8)}` : row.service?.name ?? 'Atendimento'}</span>
                        <span className="text-xs text-slate-500">{new Date(row.starts_at).toLocaleDateString('pt-BR')}</span>
                      </div>
                      <p className="text-sm font-semibold text-slate-200">{client} · {row.service_order_location_name || row.address || 'Local não informado'}</p>
                      <p className="mt-1 line-clamp-2 text-sm text-slate-400">{summary(row)}</p>
                      <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-500">
                        <span className="flex items-center gap-1"><PenTool size={12} /> {row.employee?.name || 'Sem profissional'}</span>
                        <span className="flex items-center gap-1"><Camera size={12} /> {photos.length} arquivo(s)</span>
                        {row.service_order_signed_by && <span className="flex items-center gap-1 text-emerald-400"><CheckCircle2 size={12} /> Sign-off: {row.service_order_signed_by}</span>}
                        {state === 'quote' && <span className="flex items-center gap-1 text-violet-300"><Receipt size={12} /> Cotação em andamento</span>}
                      </div>
                    </div>
                    <span className="flex items-center gap-1 text-xs font-bold text-cyan-300"><FileText size={13} /> Abrir histórico</span>
                  </div>
                </Card>
              </Link>
            )
          })}
        </div>
      )}
      <p className="flex items-center gap-1 text-xs text-slate-500"><Clock3 size={12} /> Mostrando {visible.length} de {byKind.length} registros.</p>
    </div>
  )
}
