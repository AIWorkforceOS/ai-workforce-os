import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import type { Conversation, Unit } from '@/lib/types'
import { Badge, type BadgeVariant, Card, Label, PageHeader, Select, TableShell, Td, Th, Tr } from '@/components/ui/dashboard-ui'

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'new', label: 'Novo' },
  { value: 'contacted', label: 'Contatado' },
  { value: 'replied', label: 'Respondeu' },
  { value: 'negotiating', label: 'Negociando' },
  { value: 'won', label: 'Convertido' },
  { value: 'lost', label: 'Perdido' },
  { value: 'paused', label: 'Pausado' },
]

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  new: 'slate',
  contacted: 'blue',
  replied: 'amber',
  negotiating: 'purple',
  won: 'green',
  lost: 'red',
  paused: 'slate',
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
      <PageHeader
        eyebrow="whatsapp"
        title="Conversas"
        subtitle={`Última mensagem de cada conversa entre o agente e os leads.${threads.length > 0 ? ` ${threads.length} threads ativas.` : ''}`}
      />

      <Card className="p-4">
        <form className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="unit">Unidade</Label>
            <Select id="unit" name="unit" defaultValue={params.unit ?? ''}>
              <option value="">Todas</option>
              {unitRows.map((unit) => (
                <option key={unit.id} value={unit.id}>{unit.name}</option>
              ))}
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="status">Status do lead</Label>
            <Select id="status" name="status" defaultValue={params.status ?? ''}>
              <option value="">Todos</option>
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </Select>
          </div>

          <button
            type="submit"
            className="rounded-xl px-4 py-2.5 text-sm font-bold text-white transition-all hover:scale-[1.02] active:scale-[0.98]"
            style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)', boxShadow: '0 4px 14px rgba(6,182,212,0.3)' }}
          >
            Filtrar
          </button>
          {(params.unit || params.status) && (
            <Link
              href="/dashboard/conversations"
              className="rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-300 transition-colors hover:bg-white/5"
              style={{ border: '1px solid rgba(255,255,255,0.08)' }}
            >
              Limpar filtros
            </Link>
          )}
        </form>
      </Card>

      <Card className="overflow-hidden">
        {threads.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-5 py-16 text-center">
            <p className="text-sm font-bold text-white">Nenhuma conversa encontrada</p>
            <p className="text-sm text-slate-400">
              As conversas aparecem aqui assim que o WhatsApp estiver conectado e leads responderem.
            </p>
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <TableShell>
              <Th>Lead</Th>
              <Th>Número</Th>
              <Th>Unidade</Th>
              <Th>Última mensagem</Th>
              <Th>Msgs</Th>
              <Th>Quando</Th>
              <Th>Status</Th>
            </TableShell>
            <tbody>
              {threads.map((thread) => (
                <Tr key={thread.lead_id}>
                  <Td>
                    <Link href={`/dashboard/conversations/${thread.lead_id}`} className="font-semibold text-white transition-colors hover:text-cyan-400">
                      {thread.company_name}
                    </Link>
                  </Td>
                  <Td className="text-slate-400">{thread.phone ?? '—'}</Td>
                  <Td className="text-slate-400">{thread.unit_name ?? '—'}</Td>
                  <Td className="max-w-xs truncate text-slate-400">
                    <span className="mr-1 text-slate-600">{thread.last_direction === 'inbound' ? '←' : '→'}</span>
                    {thread.last_message}
                  </Td>
                  <Td>
                    <span className="rounded-full px-2 py-0.5 text-xs font-medium text-slate-300" style={{ background: 'rgba(255,255,255,0.06)' }}>
                      {thread.msg_count}
                    </span>
                  </Td>
                  <Td className="text-slate-400">{new Date(thread.last_at).toLocaleString('pt-BR')}</Td>
                  <Td>
                    <Badge variant={STATUS_VARIANT[thread.lead_status] ?? 'slate'}>
                      {STATUS_OPTIONS.find((s) => s.value === thread.lead_status)?.label ?? thread.lead_status ?? '—'}
                    </Badge>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  )
}
