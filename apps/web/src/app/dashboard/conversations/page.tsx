import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import type { Conversation, Unit } from '@/lib/types'

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

type ConversationRow = Conversation & {
  lead: { company_name: string; phone: string | null; status: string } | null
  unit: { name: string } | null
}

export default async function ConversationsPage({
  searchParams,
}: {
  searchParams: Promise<{ unit?: string; status?: string }>
}) {
  const params = await searchParams
  const supabase = await createClient()

  const { data: units } = await supabase.from('units').select('id, name').order('name')
  const unitRows = (units ?? []) as Pick<Unit, 'id' | 'name'>[]

  let query = supabase
    .from('conversations')
    .select('*, lead:leads!inner(company_name, phone, status), unit:units(name)')
    .order('sent_at', { ascending: false })
    .limit(300)

  if (params.unit) query = query.eq('unit_id', params.unit)
  if (params.status) query = query.eq('lead.status', params.status)

  const { data: conversations } = await query
  const rows = (conversations ?? []) as unknown as ConversationRow[]

  const seenLeads = new Set<string>()
  const threads = rows.filter((row) => {
    if (seenLeads.has(row.lead_id)) return false
    seenLeads.add(row.lead_id)
    return true
  })

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Conversas</h1>
        <p className="mt-1 text-sm text-gray-500">
          Última mensagem de cada conversa entre o agente e os leads.
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
            Status do lead
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

        <button
          type="submit"
          className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700"
        >
          Filtrar
        </button>
        {(params.unit || params.status) && (
          <Link
            href="/dashboard/conversations"
            className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
          >
            Limpar filtros
          </Link>
        )}
      </form>

      <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
        {threads.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-5 py-12 text-center">
            <p className="text-sm font-medium text-gray-900">Nenhuma conversa encontrada</p>
            <p className="text-sm text-gray-400">
              As conversas aparecem aqui assim que o WhatsApp estiver conectado e leads responderem.
            </p>
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-gray-500">
                <th className="px-5 py-3 font-medium">Lead</th>
                <th className="px-5 py-3 font-medium">Número</th>
                <th className="px-5 py-3 font-medium">Unidade</th>
                <th className="px-5 py-3 font-medium">Última mensagem</th>
                <th className="px-5 py-3 font-medium">Quando</th>
                <th className="px-5 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {threads.map((thread) => (
                <tr key={thread.id} className="border-b border-gray-100 last:border-0">
                  <td className="px-5 py-3 font-medium text-gray-900">
                    {thread.lead?.company_name ?? '—'}
                  </td>
                  <td className="px-5 py-3 text-gray-600">{thread.lead?.phone ?? '—'}</td>
                  <td className="px-5 py-3 text-gray-600">{thread.unit?.name ?? '—'}</td>
                  <td className="max-w-xs truncate px-5 py-3 text-gray-600">
                    {thread.direction === 'inbound' ? '← ' : '→ '}
                    {thread.content}
                  </td>
                  <td className="px-5 py-3 text-gray-600">
                    {new Date(thread.sent_at).toLocaleString('pt-BR')}
                  </td>
                  <td className="px-5 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        STATUS_COLOR[thread.lead?.status ?? ''] ?? 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {STATUS_OPTIONS.find((s) => s.value === thread.lead?.status)?.label ??
                        thread.lead?.status ??
                        '—'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
