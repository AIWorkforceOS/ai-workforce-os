'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { UserCheck, Bot, Loader2 } from 'lucide-react'

/**
 * "Assumir atendimento" / "Devolver à automação" — Caixa de Entrada,
 * Fase 4 (docs/ux-audit-fase1-2026-08-19.md). `active` inicial vem do
 * servidor (isHumanInterventionActive); depois disso o componente decide
 * sozinho com base na resposta da própria ação, sem esperar um refresh
 * de página pra refletir o clique.
 */
export function ConversationInterventionControls({
  leadId,
  initialActive,
}: {
  leadId: string
  initialActive: boolean
}) {
  const router = useRouter()
  const [active, setActive] = useState(initialActive)
  const [busy, setBusy] = useState(false)

  async function trigger(action: 'assume' | 'release') {
    setBusy(true)
    try {
      const res = await fetch(`/api/conversations/${leadId}/intervention`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      if (res.ok) {
        const data = await res.json()
        setActive(Boolean(data.active))
        router.refresh()
      }
    } finally {
      setBusy(false)
    }
  }

  if (active) {
    return (
      <div
        className="flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4"
        style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)' }}
      >
        <div className="flex items-center gap-2.5">
          <UserCheck size={16} className="text-amber-400" />
          <div>
            <p className="text-sm font-bold text-amber-300">Atendimento assumido por um humano</p>
            <p className="text-xs text-amber-200/70">
              O agente de IA não vai responder automaticamente por até 40min desde a última mensagem manual, ou até você devolver abaixo.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => trigger('release')}
          disabled={busy}
          className="flex flex-shrink-0 items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold text-white transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)' }}
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Bot size={12} />}
          Devolver à automação
        </button>
      </div>
    )
  }

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4"
      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
    >
      <div className="flex items-center gap-2.5">
        <Bot size={16} className="text-cyan-400" />
        <p className="text-sm text-slate-300">O agente de IA está respondendo esta conversa automaticamente.</p>
      </div>
      <button
        type="button"
        onClick={() => trigger('assume')}
        disabled={busy}
        className="flex flex-shrink-0 items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold text-slate-200 transition-all hover:bg-white/5 disabled:opacity-50"
        style={{ border: '1px solid rgba(255,255,255,0.12)' }}
        title="Impede o agente de IA de responder por até 40min, pra você atender manualmente"
      >
        {busy ? <Loader2 size={12} className="animate-spin" /> : <UserCheck size={12} />}
        Assumir atendimento
      </button>
    </div>
  )
}
