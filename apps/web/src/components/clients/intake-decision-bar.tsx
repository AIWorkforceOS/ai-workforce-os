'use client'

import { useState } from 'react'

/** Ordem recebida por e-mail esperando aceite: mostra de quem veio e deixa o administrador aceitar ou recusar. */
export function IntakeDecisionBar({ unitId, appointmentId, from, subject, onDone }: { unitId: string; appointmentId: string; from: string | null; subject: string | null; onDone: () => unknown }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function send(decision: 'accept' | 'refuse') {
    if (busy) return
    if (decision === 'refuse' && !window.confirm('Recusar esta ordem? Ela será cancelada.')) return
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/units/${unitId}/appointments/${appointmentId}/intake-decision`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision }),
    }).catch(() => null)
    setBusy(false)
    if (!res || !res.ok) {
      const body = res ? ((await res.json().catch(() => null)) as { error?: string } | null) : null
      return setError(body?.error ?? 'Não foi possível registrar. Tente de novo.')
    }
    await onDone()
  }

  return (
    <div className="mt-2 flex flex-col gap-1.5 rounded-lg px-3 py-2" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)' }}>
      <p className="text-[11px] font-bold text-amber-300">Aguardando aceite · ordem recebida por e-mail</p>
      <p className="text-[11px] text-slate-400">
        {from ?? 'Remetente desconhecido'}
        {subject ? ` — ${subject}` : ''}
      </p>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" disabled={busy} onClick={() => void send('accept')} className="rounded-lg px-3 py-1 text-[11px] font-bold text-white disabled:opacity-50" style={{ background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)' }}>
          Aceitar
        </button>
        <button type="button" disabled={busy} onClick={() => void send('refuse')} className="rounded-lg px-3 py-1 text-[11px] font-bold text-red-300 disabled:opacity-50" style={{ border: '1px solid rgba(248,113,113,0.4)' }}>
          Recusar
        </button>
      </div>
      {error && (
        <p role="alert" className="text-[11px] text-red-400">
          {error}
        </p>
      )}
    </div>
  )
}
