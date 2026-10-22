'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

/** Registra no painel do cliente a decisão dele sobre a cotação: aprovar, recusar ou voltar para aguardando. */
export function QuoteDecisionButtons({ unitId, appointmentId, decision }: { unitId: string; appointmentId: string; decision: string | null }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function send(next: 'approved' | 'rejected' | 'pending') {
    if (busy) return
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/units/${unitId}/appointments/${appointmentId}/quote-decision`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: next }),
    }).catch(() => null)
    setBusy(false)
    if (!res || !res.ok) {
      const body = res ? ((await res.json().catch(() => null)) as { error?: string } | null) : null
      return setError(body?.error ?? 'Não foi possível registrar. Tente de novo.')
    }
    router.refresh()
  }

  const btn = 'rounded-lg px-2 py-1 text-[11px] font-bold disabled:opacity-50'
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      {decision === 'rejected' && <span className="text-[11px] font-bold text-red-400">Cotação recusada pelo cliente</span>}
      <div className="flex flex-wrap gap-1.5">
        {decision !== 'approved' && (
          <button type="button" disabled={busy} onClick={() => void send('approved')} className={`${btn} text-white`} style={{ background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)' }}>
            Aprovar
          </button>
        )}
        {decision !== 'rejected' && decision !== 'approved' && (
          <button type="button" disabled={busy} onClick={() => void send('rejected')} className={`${btn} text-red-300`} style={{ border: '1px solid rgba(248,113,113,0.4)' }}>
            Recusar
          </button>
        )}
        {decision && (
          <button type="button" disabled={busy} onClick={() => void send('pending')} className={`${btn} text-slate-300`} style={{ border: '1px solid rgba(255,255,255,0.12)' }}>
            Desfazer
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-[11px] text-red-400">
          {error}
        </p>
      )}
    </div>
  )
}
