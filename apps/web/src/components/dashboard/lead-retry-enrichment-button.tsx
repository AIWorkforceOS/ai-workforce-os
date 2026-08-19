'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCw, Loader2 } from 'lucide-react'

/**
 * Botão administrativo "Retry enrichment" (achado P1.1 da auditoria de
 * 18-19/08/2026) — só aparece para leads sem e-mail que já esgotaram ou
 * estão aguardando o retry automático (ver dashboard/leads/page.tsx).
 */
export function LeadRetryEnrichmentButton({ leadId }: { leadId: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<'found' | 'not_found' | null>(null)

  async function handleClick() {
    setBusy(true)
    setDone(null)
    try {
      const res = await fetch(`/api/leads/${leadId}/retry-enrichment`, { method: 'POST' })
      const data = await res.json().catch(() => null)
      setDone(data?.email ? 'found' : 'not_found')
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  if (done === 'found') {
    return <span className="text-xs font-bold text-emerald-400">E-mail encontrado ✓</span>
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-bold text-cyan-300 transition-colors hover:bg-cyan-500/10 disabled:opacity-50"
      style={{ border: '1px solid rgba(6,182,212,0.3)' }}
      title="Forçar nova tentativa de encontrar e-mail agora, sem esperar o próximo retry automático"
    >
      {busy ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
      {done === 'not_found' ? 'Tentar de novo' : 'Retry enrichment'}
    </button>
  )
}
