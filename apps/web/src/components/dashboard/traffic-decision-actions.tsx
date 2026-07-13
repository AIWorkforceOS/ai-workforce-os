'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, X } from 'lucide-react'

/**
 * Botões de aprovar/rejeitar de uma decisão do Traffic Specialist.
 * Aprovação de decisão executável dispara a ação real na plataforma
 * (via /api/traffic/decisions/[id]) — o texto do botão deixa isso claro.
 */
export function TrafficDecisionActions({
  decisionId,
  executable,
}: {
  decisionId: string
  executable: boolean
}) {
  const router = useRouter()
  const [pending, setPending] = useState<'approve' | 'reject' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function act(action: 'approve' | 'reject') {
    setPending(action)
    setError(null)
    try {
      const response = await fetch(`/api/traffic/decisions/${decisionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const data = await response.json()
      if (!response.ok) {
        setError(data.error ?? 'Falha ao processar a decisão.')
        return
      }
      router.refresh()
    } catch {
      setError('Erro de rede ao processar a decisão.')
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex gap-2">
        <button
          onClick={() => act('approve')}
          disabled={pending !== null}
          className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold text-white transition-all hover:scale-[1.02] disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg, #22c55e, #16a34a)' }}
          title={executable ? 'Aprova e executa a mudança na conta de anúncio' : 'Marca a recomendação como ciente'}
        >
          <Check size={12} />
          {pending === 'approve' ? 'Processando…' : executable ? 'Aprovar e executar' : 'Ciente'}
        </button>
        <button
          onClick={() => act('reject')}
          disabled={pending !== null}
          className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold text-slate-300 transition-all hover:bg-white/5 disabled:opacity-50"
          style={{ border: '1px solid rgba(255,255,255,0.1)' }}
        >
          <X size={12} />
          {pending === 'reject' ? '…' : 'Rejeitar'}
        </button>
      </div>
      {error && <p className="text-[11px] text-red-400">{error}</p>}
    </div>
  )
}
