'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, RefreshCw } from 'lucide-react'

/** Roda a auditoria técnica agora, fora do ciclo do cron (POST /api/seo/units/[unitId]/audits/run). */
export function SeoAuditRunButton({ unitId }: { unitId: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/seo/units/${unitId}/audits/run`, { method: 'POST' })
      const data = await response.json()
      if (!response.ok) {
        setError(data.error ?? 'Falha ao rodar a auditoria.')
        return
      }
      router.refresh()
    } catch {
      setError('Erro de rede ao rodar a auditoria.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={run}
        disabled={busy}
        className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold text-white disabled:opacity-60"
        style={{ background: 'linear-gradient(135deg, #06b6d4, #4361ee)', boxShadow: '0 4px 12px rgba(6,182,212,0.25)' }}
      >
        {busy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
        {busy ? 'Auditando…' : 'Rodar auditoria agora'}
      </button>
      {error && <p className="max-w-[220px] text-right text-[11px] text-red-400">{error}</p>}
    </div>
  )
}
