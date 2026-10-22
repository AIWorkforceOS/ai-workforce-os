'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Label, Select } from '@/components/ui/dashboard-ui'
import { clientNameOf, NO_CLIENT_LABEL } from '@/lib/billing/by-client'
import { linkAppointmentToClient } from '@/lib/clients/link-client'

/** "Cliente desta ordem": mostra a qual cliente cadastrado a WO pertence e permite vincular/trocar (ex.: WO que chegou por e-mail). */
export function ClientLinkSection({
  appointment,
  unitId,
  orgId,
  onChanged,
}: {
  appointment: { id: string; customer: { name: string | null; client_company?: string | null } | null }
  unitId: string
  orgId: string
  onChanged: () => void | Promise<void>
}) {
  const current = clientNameOf(appointment.customer)
  const [options, setOptions] = useState<string[]>([])
  const [selected, setSelected] = useState(current === NO_CLIENT_LABEL ? '' : current)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    void fetch('/api/client-profiles')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { profiles?: { name: string }[] } | null) => {
        if (!cancelled && data?.profiles) setOptions(data.profiles.map((p) => p.name))
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  const all = Array.from(new Set([...options, ...(current !== NO_CLIENT_LABEL ? [current] : [])]))
  const changed = selected !== '' && selected.toLowerCase() !== (current === NO_CLIENT_LABEL ? '' : current.toLowerCase())

  async function save() {
    if (!changed || busy) return
    setBusy(true)
    setMessage(null)
    const result = await linkAppointmentToClient(createClient(), { appointmentId: appointment.id, unitId, orgId, clientName: selected })
    setBusy(false)
    if (!result.ok) return setMessage({ ok: false, text: result.error })
    setMessage({ ok: true, text: `Ordem vinculada a ${selected}. O PDF e o faturamento seguem este cliente.` })
    await onChanged()
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-xl px-3.5 py-3" style={{ background: 'rgba(6,182,212,0.06)', border: '1px solid rgba(6,182,212,0.22)' }}>
      <Label>Cliente desta ordem</Label>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={selected} onChange={(e) => setSelected(e.target.value)} className="py-1.5 text-sm" style={{ minWidth: 220 }} aria-label="Cliente da ordem">
          {current === NO_CLIENT_LABEL && <option value="">Sem cliente vinculado</option>}
          {all.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </Select>
        <button type="button" disabled={!changed || busy} onClick={() => void save()} className="rounded-lg px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50" style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)' }}>
          {busy ? 'Vinculando…' : 'Vincular'}
        </button>
      </div>
      <p className="text-[11px] text-slate-400">
        {current === NO_CLIENT_LABEL ? 'Esta ordem ainda não está ligada a um cliente cadastrado.' : `Hoje: ${current}.`} Cadastre novos clientes em “Clientes Facility”.
      </p>
      {message && (
        <p role={message.ok ? 'status' : 'alert'} className={`text-xs font-semibold ${message.ok ? 'text-emerald-400' : 'text-red-400'}`}>
          {message.text}
        </p>
      )}
    </div>
  )
}
