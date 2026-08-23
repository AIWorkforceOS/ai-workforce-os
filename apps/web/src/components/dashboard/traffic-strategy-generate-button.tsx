'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Sparkles } from 'lucide-react'

/**
 * Gera uma campanha inteira do zero (estudo do negócio/público, verba,
 * criativo com imagem, previsão de leads/custo) via IA — pedido do
 * Vinicius, 2026-08-23. POST /api/traffic/accounts/[id]/strategy-drafts;
 * o resultado cai na fila "Criativos aguardando aprovação" logo abaixo.
 */
export function TrafficStrategyGenerateButton({ accountId, accountName }: { accountId: string; accountName: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function generate() {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/traffic/accounts/${accountId}/strategy-drafts`, { method: 'POST' })
      const data = await response.json()
      if (!response.ok) {
        setError(data.error ?? 'Falha ao gerar a campanha.')
        return
      }
      router.refresh()
    } catch {
      setError('Erro de rede ao gerar a campanha.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        onClick={generate}
        disabled={busy}
        className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold text-white transition-all hover:scale-[1.02] disabled:opacity-60"
        style={{ background: 'linear-gradient(135deg, #06b6d4, #4361ee)' }}
        title={`Gera uma campanha completa para ${accountName} a partir da ficha do negócio`}
      >
        {busy ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
        {busy ? 'Estudando o negócio…' : 'Criar campanha com IA'}
      </button>
      {error && <p className="max-w-[220px] text-[11px] text-red-400">{error}</p>}
    </div>
  )
}
