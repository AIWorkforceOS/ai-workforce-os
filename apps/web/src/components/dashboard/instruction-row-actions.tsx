'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

/** Pausar / retomar / encerrar hoje uma instrução. Não altera posts já publicados nem apaga nada: o histórico fica. */
export function InstructionRowActions({ id, paused, endsOn, today }: { id: string; paused: boolean; endsOn: string | null; today: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(body: Record<string, unknown>) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/content/instructions/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Erro')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro')
    } finally {
      setBusy(false)
    }
  }

  const btn = 'rounded-lg border border-white/10 px-2.5 py-1 text-[11px] font-bold text-slate-300 hover:bg-white/5 disabled:opacity-50'
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" disabled={busy} className={btn} onClick={() => run({ action: paused ? 'resume' : 'pause' })}>
        {paused ? 'Retomar' : 'Pausar'}
      </button>
      {(endsOn === null || endsOn > today) && (
        <button type="button" disabled={busy} className={btn} onClick={() => run({ action: 'set_dates', ends_on: today })}>
          Encerrar hoje
        </button>
      )}
      {error && <span className="text-[11px] text-red-300">{error}</span>}
    </div>
  )
}
