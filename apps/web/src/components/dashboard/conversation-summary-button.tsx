'use client'

import { useState } from 'react'
import { Sparkles, Loader2 } from 'lucide-react'

/**
 * "Gerar resumo" — sob demanda, nunca dispara sozinho (decisão do
 * Vinicius em 2026-08-20: custo de IA só quando o usuário pedir
 * explicitamente). Não persiste: cada clique gera de novo.
 */
export function ConversationSummaryButton({ leadId }: { leadId: string }) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ summary: string; intent: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleClick() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/conversations/${leadId}/summarize`, { method: 'POST' })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setError(data?.message ?? 'Não deu pra gerar o resumo agora.')
        return
      }
      setResult({ summary: data.summary, intent: data.intent })
    } catch {
      setError('Não deu pra gerar o resumo agora.')
    } finally {
      setBusy(false)
    }
  }

  if (result) {
    return (
      <div className="rounded-2xl p-4" style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.25)' }}>
        <div className="flex items-center gap-2">
          <Sparkles size={13} className="text-indigo-400" />
          <p className="text-xs font-bold uppercase tracking-wide text-indigo-300">Resumo gerado por IA</p>
        </div>
        <p className="mt-2 text-sm text-slate-200">{result.summary}</p>
        <p className="mt-1.5 text-xs text-slate-400">Intenção detectada: <span className="font-semibold text-slate-300">{result.intent}</span></p>
        <button type="button" onClick={handleClick} disabled={busy} className="mt-2 text-[11px] font-semibold text-indigo-300 hover:underline disabled:opacity-50">
          {busy ? 'Gerando...' : 'Gerar de novo'}
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        className="flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold text-indigo-300 transition-all hover:bg-indigo-500/10 disabled:opacity-50"
        style={{ border: '1px solid rgba(99,102,241,0.3)' }}
      >
        {busy ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
        {busy ? 'Gerando resumo...' : 'Gerar resumo com IA'}
      </button>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </div>
  )
}
