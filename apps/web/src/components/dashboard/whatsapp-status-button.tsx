'use client'

import { useEffect, useRef, useState } from 'react'
import { MessageCircle } from 'lucide-react'
import { WhatsAppConnection } from './whatsapp-connection'

type Status = 'open' | 'connecting' | 'close' | 'not_configured' | 'error' | 'loading'

const STATUS_LABEL: Record<Status, string> = {
  open: 'WhatsApp conectado',
  connecting: 'Conectando...',
  close: 'WhatsApp desconectado',
  not_configured: 'WhatsApp não configurado',
  error: 'Erro ao verificar',
  loading: 'Verificando WhatsApp...',
}

const STATUS_STYLE: Record<Status, { bg: string; color: string }> = {
  open: { bg: 'rgba(34,197,94,0.12)', color: '#4ade80' },
  connecting: { bg: 'rgba(245,158,11,0.12)', color: '#fbbf24' },
  close: { bg: 'rgba(239,68,68,0.12)', color: '#f87171' },
  not_configured: { bg: 'rgba(255,255,255,0.06)', color: '#64748b' },
  error: { bg: 'rgba(239,68,68,0.12)', color: '#f87171' },
  loading: { bg: 'rgba(255,255,255,0.06)', color: '#64748b' },
}

/**
 * Botão de status do WhatsApp por funcionário digital (pedido do
 * Vinicius, 2026-09-11, depois de "a Ana Rec desconectou e não estou
 * conseguindo logar de novo"): checa o status de verdade (não só se um
 * número já foi cadastrado um dia) assim que o card aparece na tela —
 * "só em clicar já podemos visualizar se a conexão está boa" — e expande
 * o fluxo de reconexão (QR code) no mesmo lugar, sem precisar navegar
 * pra outra tela.
 */
export function WhatsAppStatusButton({ unitId, agentType, label }: { unitId: string; agentType: string; label: string }) {
  const [status, setStatus] = useState<Status>('loading')
  const [expanded, setExpanded] = useState(false)
  const fetchedRef = useRef(false)

  useEffect(() => {
    if (fetchedRef.current) return
    fetchedRef.current = true
    let cancelled = false
    fetch(`/api/units/${unitId}/whatsapp/status?agentType=${encodeURIComponent(agentType)}`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setStatus((data.status as Status) ?? 'error')
      })
      .catch(() => {
        if (!cancelled) setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [unitId, agentType])

  const needsAttention = status === 'close' || status === 'error'

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-[11px] font-bold transition-colors hover:brightness-110"
        style={{ background: STATUS_STYLE[status].bg, color: STATUS_STYLE[status].color }}
      >
        <span className="flex items-center gap-1.5">
          <MessageCircle size={12} />
          {STATUS_LABEL[status]}
        </span>
        <span>{needsAttention ? 'Reconectar →' : expanded ? 'Ocultar' : 'Ver'}</span>
      </button>
      {expanded && (
        <div className="mt-2">
          <WhatsAppConnection unitId={unitId} agentType={agentType} label={label} />
        </div>
      )}
    </div>
  )
}
