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
  new: 'bg-slate-100 text-slate-600',
  contacted: 'bg-blue-100 text-blue-700',
  replied: 'bg-amber-100 text-amber-700',
  negotiating: 'bg-purple-100 text-purple-700',
  won: 'bg-green-100 text-green-700',
  lost: 'bg-red-100 text-red-700',
  paused: 'bg-slate-100 text-slate-500',
}

type ConversationRow = Conversation & {
  lead: { company_name: string; phone: string | null; status: string } | null
  unit: { name: string } | null
}

type ThreadSummary = {
  lead_id: string
  company_name: string
  phone: string | null
  unit_name: string | null
  lead_status: string
  last_message: string
  last_direction: 'inbound' | 'outbound'
  last_at: string
  msg_count: number
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
    .limit(500)

  if (params.unit) query = query.eq('unit_id', params.unit)
  if (params.status) query = query.eq('lead.status', params.status)

  const { data: conversations } = await query
  const rows = (conversations ?? []) as unknown as ConversationRow[]

  // Group by lead_id and build thread summaries
  const threadMap = new Map<string, ThreadSummary>()
  for (const row of rows) {
    if (!threadMap.has(row.lead_id)) {
      threadMap.set(row.lead_id, {
        lead_id: row.lead_id,
        company_name: row.lead?.company_name ?? '—',
        phone: row.lead?.phone ?? null,
        unit_name: row.unit?.name ?? null,
        lead_status: row.lead?.status ?? '',
        last_message: row.content,
        last_direction: row.direction,
        last_at: row.sent_at,
        msg_count: 1,
      })
    } else {
      const t = threadMap.get(row.lead_id)!
      t.msg_count += 1
    }
  }
  const threads = Array.from(threadMap.values())

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Conversas</h1>
        <p className="mt-1 text-sm text-slate-500">
          Última mensagem de cada conversa entre o agente e os leads.{' '}
          {threads.length > 0 && (
            <span className="font-medium text-slate-700">{threads.length} threads ativas.</span>
          )}
        </p>
      </div>

      <form className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-1">
          <label htmlFor="unit" className="text-xs font-medium text-slate-500">
            Unidade
          </label>
          <select
            id="unit"
            name="unit"
            defaultValue={params.unit ?? ''}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
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
          <label htmlFor="status" className="text-xs font-medium text-slate-500">
            Status do lead
          </label>
          <select
            id="status"
            name="status"
            defaultValue={params.status ?? ''}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
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
          className="rounded-md bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700"
        >
          Filtrar
        </button>
        {(params.unit || params.status) && (
          <Link
            href="/dashboard/conversations"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            Limpar filtros
          </Link>
        )}
      </form>

      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        {threads.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-5 py-12 text-center">
            <p className="text-sm font-medium text-slate-900">Nenhuma conversa encontrada</p>
            <p className="text-sm text-slate-400">
              As conversas aparecem aqui assim que o WhatsApp estiver conectado e leads responderem.
            </p>
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="px-5 py-3 font-medium">Lead</th>
                <th className="px-5 py-3 font-medium">Número</th>
                <th className="px-5 py-3 font-medium">Unidade</th>
                <th className="px-5 py-3 font-medium">Última mensagem</th>
                <th className="px-5 py-3 font-medium">Msgs</th>
                <th className="px-5 py-3 font-medium">Quando</th>
                <th className="px-5 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {threads.map((thread) => (
                <tr key={thread.lead_id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="px-5 py-3 font-medium text-slate-900">
                    <Link
                      href={`/dashboard/conversations/${thread.lead_id}`}
                      className="hover:text-green-600 hover:underline"
                    >
                      {thread.company_name}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-slate-600">{thread.phone ?? '—'}</td>
                  <td className="px-5 py-3 text-slate-600">{thread.unit_name ?? '—'}</td>
                  <td className="max-w-xs truncate px-5 py-3 text-slate-600">
                    <span className="mr-1 text-slate-400">
                      {thread.last_direction === 'inbound' ? '←' : '→'}
                    </span>
                    {thread.last_message}
                  </td>
                  <td className="px-5 py-3 text-center">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                      {thread.msg_count}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-slate-600">
                    {new Date(thread.last_at).toLocaleString('pt-BR')}
                  </td>
                  <td className="px-5 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        STATUS_COLOR[thread.lead_status] ?? 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {STATUS_OPTIONS.find((s) => s.value === thread.lead_status)?.label ??
                        thread.lead_status ??
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
