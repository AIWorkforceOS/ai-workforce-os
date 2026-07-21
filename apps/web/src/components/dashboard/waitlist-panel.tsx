'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { StatusPill, TableShell, Td, Th, Tr } from '@/components/ui/dashboard-ui'
import type { BadgeVariant } from '@/components/ui/dashboard-ui'
import type { WaitlistStatus } from '@/lib/types'

export type WaitlistRow = {
  id: string
  status: WaitlistStatus
  preferred_starts_at: string | null
  preferred_notes: string | null
  created_at: string
  customer: { name: string } | null
  service: { name: string } | null
}

const STATUS_LABEL: Record<WaitlistStatus, string> = {
  waiting: 'Aguardando',
  notified: 'Notificado',
  converted: 'Convertido',
  removed: 'Removido',
}

const STATUS_VARIANT: Record<WaitlistStatus, BadgeVariant> = {
  waiting: 'amber',
  notified: 'cyan',
  converted: 'green',
  removed: 'slate',
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export function WaitlistPanel({ unitId, initialEntries }: { unitId: string; initialEntries: WaitlistRow[] }) {
  const [entries, setEntries] = useState<WaitlistRow[]>(initialEntries)

  async function handleRemove(entry: WaitlistRow) {
    if (!window.confirm(`Remover ${entry.customer?.name ?? 'este cliente'} da lista de espera?`)) return
    const supabase = createClient()
    const { error } = await supabase.from('waitlist_entries').delete().eq('id', entry.id)
    if (error) return
    setEntries((prev) => prev.filter((e) => e.id !== entry.id))
  }

  if (entries.length === 0) {
    return <p className="px-1 text-sm text-slate-500">Nenhum cliente na lista de espera.</p>
  }

  return (
    <div className="overflow-hidden rounded-2xl bg-[#141a2b]" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.06)' }}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <TableShell>
            <Th>Cliente</Th>
            <Th>Serviço</Th>
            <Th>Data/hora preferida</Th>
            <Th>Adicionado em</Th>
            <Th>Status</Th>
            <Th>Ações</Th>
          </TableShell>
          <tbody>
            {entries.map((entry) => (
              <Tr key={entry.id}>
                <Td className="font-semibold text-white">{entry.customer?.name ?? '—'}</Td>
                <Td className="text-slate-400">{entry.service?.name ?? '—'}</Td>
                <Td className="text-slate-400">{formatDateTime(entry.preferred_starts_at)}</Td>
                <Td className="text-slate-400">{formatDateTime(entry.created_at)}</Td>
                <Td>
                  <StatusPill variant={STATUS_VARIANT[entry.status]}>{STATUS_LABEL[entry.status]}</StatusPill>
                </Td>
                <Td>
                  <div className="flex gap-3 text-xs font-semibold">
                    <Link href={`/dashboard/units/${unitId}/agenda/calendario`} className="text-cyan-400 hover:text-cyan-300">
                      Agendar
                    </Link>
                    <button type="button" className="text-red-400 hover:text-red-300" onClick={() => handleRemove(entry)}>
                      Remover
                    </button>
                  </div>
                </Td>
              </Tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
