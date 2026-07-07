import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { SECTOR_OPTIONS, type Lead, type Unit } from '@/lib/types'

const PAGE_SIZE = 20

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'new', label: 'Novo' },
  { value: 'contacted', label: 'Contatado' },
  { value: 'replied', label: 'Respondeu' },
  { value: 'negotiating', label: 'Negociando' },
  { value: 'won', label: 'Convertido' },
  { value: 'lost', label: 'Perdido' },
  { value: 'paused', label: 'Pausado' },
]

const STATUS_COLOR: Record<string, string> = {
  new: 'bg-gray-100 text-gray-600',
  contacted: 'bg-blue-100 text-blue-700',
  replied: 'bg-amber-100 text-amber-700',
  negotiating: 'bg-purple-100 text-purple-700',
  won: 'bg-green-100 text-green-700',
  lost: 'bg-red-100 text-red-700',
  paused: 'bg-gray-100 text-gray-500',
}

const SECTOR_LABELS: Record<string, string> = {
  tecnologia: 'Tecnologia',
  industria: 'Indústria',
  comercio: 'Comércio',
  servicos: 'Serviços',
  saude: 'Saúde',
  educacao: 'Educação',
}

type LeadWithUnit = Lead & { unit: { name: string } | null }

function daysSince(dateStr: string | null): number | null {
  if (!dateStr) return null
  const ms = Date.now() - new Date(dateStr).getTime()
  return Math.floor(ms / (1000 * 60 * 60 * 24))
}

function DaysBadge({ days }: { days: number | null }) {
  if (days === null) return <span className="text-gray-400">—</span>
  const color =
    days > 7
      ? 'bg-red-100 text-red-700'
      : days > 3
        ? 'bg-amber-100 text-amber-700'
        : 'bg-green-100 text-green-700'
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${color}`}>
      {days === 0 ? 'hoje' : `${days}d`}
    </span>
  )
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ unit?: string; status?: string; sector?: string; page?: string }>
}) {
  const params = await searchParams
  const page = Math.max(1, Number(params.page) || 1)
  const offset = (page - 1) * PAGE_SIZE

  const supabase = await createClient()

  const { data: units } = await supabase.from('units').select('id, name').order('name')
  const unitRows = (units ?? []) as Pick<Unit, 'id' | 'name'>[]

  let query = supabase
    .from('leads')
    .select('*, unit:units(name)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1)

  if (params.unit) query = query.eq('unit_id', params.unit)
  if (params.status) query = query.eq('status', params.status)
  if (params.sector) query = query.eq('sector', params.sector)

  const { data: leads, count } = await query

  const leadRows = (leads ?? []) as unknown as LeadWithUnit[]
  const total = count ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  function pageHref(targetPage: number) {
    const q = new URLSearchParams()
    if (params.unit) q.set('unit', params.unit)
    if (params.status) q.set('status', params.status)
    if (params.sector) q.set('sector', params.sector)
    q.set('page', String(targetPage))
    return `/dashboard/leads?${q.toString()}`
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Leads</h1>
        <p className="mt-1 text-sm text-gray-500">
          Leads prospectados pelo agente SDR em todas as unidades.{' '}
          {total > 0 && <span className="font-medium text-gray-700">{total} no total.</span>}
        </p>
      </div>

      <form className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-1">
          <label htmlFor="unit" className="text-xs font-medium text-gray-500">
            Unidade
          </label>
          <select
            id="unit"
            name="unit"
            defaultValue={params.unit ?? ''}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-gray-400"
          >
            <option value="">Todas</option>
            {unitRows.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="status" className="text-xs font-medium text-gray-500">
            Status
          </label>
          <select
            id="status"
            name="status"
            defaultValue={params.status ?? ''}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-gray-400"
          >
            <option value="">Todos</option>
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="sector" className="text-xs font-medium text-gray-500">
            Setor
          </label>
          <select
            id="sector"
            name="sector"
            defaultValue={params.sector ?? ''}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-gray-400"
          >
            <option value="">Todos</option>
            {SECTOR_OPTIONS.map((sector) => (
              <option key={sector} value={sector}>
                {SECTOR_LABELS[sector]}
              </option>
            ))}
          </select>
        </div>

        <button
          type="submit"
          className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700"
        >
          Filtrar
        </button>
        {(params.unit || params.status || params.sector) && (
          <Link
            href="/dashboard/leads"
            className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
          >
            Limpar filtros
          </Link>
        )}
      </form>

      <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
        {leadRows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-5 py-12 text-center">
            <p className="text-sm font-medium text-gray-900">Nenhum lead encontrado</p>
            <p className="text-sm text-gray-500">
              Ajuste os filtros ou prospecte novos leads em uma unidade.
            </p>
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-gray-500">
                <th className="px-5 py-3 font-medium">Empresa</th>
                <th className="px-5 py-3 font-medium">Telefone</th>
                <th className="px-5 py-3 font-medium">Cidade</th>
                <th className="px-5 py-3 font-medium">Unidade</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Último contato</th>
                <th className="px-5 py-3 font-medium">Sem resposta</th>
              </tr>
            </thead>
            <tbody>
              {leadRows.map((lead) => {
                const days = daysSince(lead.last_contacted_at ?? lead.created_at)
                return (
                  <tr
                    key={lead.id}
                    className="border-b border-gray-100 last:border-0 hover:bg-gray-50"
                  >
                    <td className="px-5 py-3 font-medium text-gray-900">
                      <Link
                        href={`/dashboard/conversations/${lead.id}`}
                        className="hover:text-blue-600 hover:underline"
                      >
                        {lead.company_name}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-gray-600">{lead.phone ?? '—'}</td>
                    <td className="px-5 py-3 text-gray-600">
                      {lead.city ?? '—'}
                      {lead.state ? `, ${lead.state}` : ''}
                    </td>
                    <td className="px-5 py-3 text-gray-600">{lead.unit?.name ?? '—'}</td>
                    <td className="px-5 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          STATUS_COLOR[lead.status] ?? 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {STATUS_OPTIONS.find((s) => s.value === lead.status)?.label ?? lead.status}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-gray-600">
                      {lead.last_contacted_at
                        ? new Date(lead.last_contacted_at).toLocaleDateString('pt-BR')
                        : new Date(lead.created_at).toLocaleDateString('pt-BR')}
                    </td>
                    <td className="px-5 py-3">
                      <DaysBadge days={days} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-600">
          <span>
            Página {page} de {totalPages} — {total} leads
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link
                href={pageHref(page - 1)}
                className="rounded-md border border-gray-300 px-3 py-1.5 hover:bg-gray-100"
              >
                Anterior
              </Link>
            )}
            {page < totalPages && (
              <Link
                href={pageHref(page + 1)}
                className="rounded-md border border-gray-300 px-3 py-1.5 hover:bg-gray-100"
              >
                Próxima
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
