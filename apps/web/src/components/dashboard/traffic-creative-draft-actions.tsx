'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, X } from 'lucide-react'

function centsToInputValue(cents: number): string {
  return (cents / 100).toFixed(2)
}

function inputValueToCents(value: string): number | null {
  const parsed = Number(value.replace(',', '.'))
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return Math.round(parsed * 100)
}

/**
 * Botões de aprovar/rejeitar de um rascunho de campanha (texto + imagem +
 * estratégia gerada por IA) do Traffic Specialist — pedido do Vinicius,
 * 2026-08-23: o dono pode editar a verba diária proposta antes de aprovar,
 * e ao aprovar a campanha já nasce E É ATIVADA na mesma hora ("o humano só
 * clica autorizando e ele já inicia") — não fica PAUSED esperando um
 * segundo clique.
 */
export function TrafficCreativeDraftActions({ draftId, initialDailyBudgetCents }: { draftId: string; initialDailyBudgetCents: number }) {
  const router = useRouter()
  const [budgetInput, setBudgetInput] = useState(centsToInputValue(initialDailyBudgetCents))
  const [pending, setPending] = useState<'approve' | 'reject' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function act(action: 'approve' | 'reject') {
    const dailyBudgetCents = action === 'approve' ? inputValueToCents(budgetInput) : null
    if (action === 'approve' && dailyBudgetCents === null) {
      setError('Verba diária inválida.')
      return
    }

    setPending(action)
    setError(null)
    try {
      const response = await fetch(`/api/traffic/creative-drafts/${draftId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action === 'approve' ? { action, dailyBudgetCents } : { action }),
      })
      const data = await response.json()
      if (!response.ok) {
        setError(data.error ?? 'Falha ao processar o rascunho.')
        return
      }
      router.refresh()
    } catch {
      setError('Erro de rede ao processar o rascunho.')
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
        Verba/dia (R$)
        <input
          type="text"
          inputMode="decimal"
          value={budgetInput}
          onChange={(e) => setBudgetInput(e.target.value)}
          disabled={pending !== null}
          className="w-20 rounded-lg px-2 py-1 text-right text-xs font-bold text-white"
          style={{ border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.03)' }}
        />
      </label>
      <div className="flex gap-2">
        <button
          onClick={() => act('approve')}
          disabled={pending !== null}
          className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold text-white transition-all hover:scale-[1.02] disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg, #22c55e, #16a34a)' }}
          title="Aprova, lança e já ativa a campanha na plataforma"
        >
          <Check size={12} />
          {pending === 'approve' ? 'Lançando…' : 'Aprovar e ativar'}
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
      {error && <p className="max-w-[180px] text-right text-[11px] text-red-400">{error}</p>}
    </div>
  )
}
