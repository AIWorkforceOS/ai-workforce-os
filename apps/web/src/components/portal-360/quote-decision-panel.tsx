'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

/** Portal do cliente: aprovar ou recusar a cotação da ordem (uma vez; depois só o escritório altera). */
export function QuoteDecisionPanel({ appointmentId, decision, decidedAt }: { appointmentId: string; decision: string | null; decidedAt: string | null }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<'approved' | 'rejected' | null>(null)
  const [note, setNote] = useState('')

  if (decision === 'approved' || decision === 'rejected') {
    const approved = decision === 'approved'
    return (
      <p role="status" className="rounded-xl px-4 py-3 text-sm font-bold" style={{ background: approved ? 'rgba(16,185,129,0.1)' : 'rgba(248,113,113,0.1)', color: approved ? '#34d399' : '#f87171', border: `1px solid ${approved ? 'rgba(16,185,129,0.3)' : 'rgba(248,113,113,0.3)'}` }}>
        {approved ? 'Quote approved' : 'Quote declined'}
        {decidedAt ? ` on ${new Date(decidedAt).toLocaleDateString('en-US')}` : ''}. Contact the office if you need to change it.
      </p>
    )
  }

  async function send(next: 'approved' | 'rejected') {
    if (busy) return
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/portal-360/orders/${appointmentId}/quote-decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: next, note: note.trim() || undefined }),
    }).catch(() => null)
    setBusy(false)
    if (!res || !res.ok) {
      const body = res ? ((await res.json().catch(() => null)) as { error?: string } | null) : null
      return setError(body?.error ?? 'Could not record your decision. Try again.')
    }
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-slate-400">Review the quote above, then approve or decline it. This decision is sent to the office.</p>
      {confirm ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-bold text-white">{confirm === 'approved' ? 'Approve this quote?' : 'Decline this quote?'}</p>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2} placeholder="Optional note for the office" className="w-full rounded-xl bg-[#0b0f1a] px-3 py-2 text-sm text-white" style={{ border: '1px solid rgba(255,255,255,0.1)' }} />
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={() => void send(confirm)} className="rounded-xl px-4 py-2 text-xs font-bold text-white disabled:opacity-50" style={{ background: confirm === 'approved' ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)' : 'linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)' }}>
              {busy ? 'Saving…' : 'Confirm'}
            </button>
            <button type="button" disabled={busy} onClick={() => setConfirm(null)} className="rounded-xl px-4 py-2 text-xs font-bold text-slate-300" style={{ border: '1px solid rgba(255,255,255,0.12)' }}>
              Back
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <button type="button" onClick={() => setConfirm('approved')} className="rounded-xl px-4 py-2 text-xs font-bold text-white" style={{ background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)' }}>
            Approve quote
          </button>
          <button type="button" onClick={() => setConfirm('rejected')} className="rounded-xl px-4 py-2 text-xs font-bold text-red-300" style={{ border: '1px solid rgba(248,113,113,0.4)' }}>
            Decline
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs font-semibold text-red-400">
          {error}
        </p>
      )}
    </div>
  )
}
