'use client'

import { useEffect, useRef, useState } from 'react'
import { Card } from '@/components/ui/dashboard-ui'

type Status = 'open' | 'connecting' | 'close' | 'not_configured' | 'error' | 'loading'

const STATUS_LABEL: Record<Status, string> = {
  open: 'Conectado',
  connecting: 'Conectando...',
  close: 'Desconectado',
  not_configured: 'Sem configuração',
  error: 'Erro ao verificar status',
  loading: 'Verificando...',
}

const STATUS_STYLE: Record<Status, { bg: string; color: string }> = {
  open: { bg: 'rgba(34,197,94,0.12)', color: '#4ade80' },
  connecting: { bg: 'rgba(245,158,11,0.12)', color: '#fbbf24' },
  close: { bg: 'rgba(255,255,255,0.06)', color: '#94a3b8' },
  not_configured: { bg: 'rgba(255,255,255,0.06)', color: '#64748b' },
  error: { bg: 'rgba(239,68,68,0.12)', color: '#f87171' },
  loading: { bg: 'rgba(255,255,255,0.06)', color: '#64748b' },
}

export function WhatsAppConnection({ unitId }: { unitId: string }) {
  const [status, setStatus] = useState<Status>('loading')
  const [qrCode, setQrCode] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  async function fetchStatus() {
    try {
      const res = await fetch(`/api/units/${unitId}/whatsapp/status`)
      const data = await res.json()
      if (!res.ok) {
        setStatus('error')
        setError(data.error ?? 'Erro ao verificar status.')
        return data.status as Status
      }
      setStatus(data.status as Status)
      setError(null)
      return data.status as Status
    } catch {
      setStatus('error')
      setError('Não foi possível verificar o status.')
      return 'error'
    }
  }

  useEffect(() => {
    fetchStatus()
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [unitId])

  function startPolling() {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      const current = await fetchStatus()
      if (current === 'open') {
        setQrCode(null)
        if (pollRef.current) clearInterval(pollRef.current)
      }
    }, 3000)
  }

  async function handleConnect() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/units/${unitId}/whatsapp/connect`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Erro ao conectar.')
        setBusy(false)
        return
      }
      setQrCode(data.qrCode ?? null)
      setStatus('connecting')
      startPolling()
    } catch {
      setError('Não foi possível iniciar a conexão.')
    }
    setBusy(false)
  }

  async function handleDisconnect() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/units/${unitId}/whatsapp/disconnect`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Erro ao desconectar.')
        setBusy(false)
        return
      }
      setQrCode(null)
      await fetchStatus()
    } catch {
      setError('Não foi possível desconectar.')
    }
    setBusy(false)
  }

  return (
    <Card className="flex w-full flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold text-white">WhatsApp</h2>
          <p className="mt-1 text-sm text-slate-400">
            Conecte o número desta unidade escaneando um QR code — igual ao WhatsApp Web.
          </p>
        </div>
        <span className="rounded-full px-2.5 py-1 text-xs font-bold" style={STATUS_STYLE[status]}>
          {STATUS_LABEL[status]}
        </span>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {status === 'not_configured' && (
        <p className="text-sm text-slate-500">
          O serviço de WhatsApp ainda não está habilitado para esta unidade. Fale com a gente em
          suporte@alizo.com.br que habilitamos rapidinho.
        </p>
      )}

      {qrCode && (
        <div className="flex flex-col items-center gap-2 rounded-xl p-4" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <img
            src={qrCode.startsWith('data:') ? qrCode : `data:image/png;base64,${qrCode}`}
            alt="QR Code do WhatsApp"
            className="h-56 w-56 rounded-lg"
          />
          <p className="text-xs text-slate-500">Escaneie com o WhatsApp da unidade.</p>
        </div>
      )}

      <div className="flex gap-3">
        {status !== 'open' && status !== 'not_configured' && (
          <button
            onClick={handleConnect}
            disabled={busy}
            className="rounded-xl px-4 py-2 text-sm font-bold text-white transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)', boxShadow: '0 4px 14px rgba(6,182,212,0.3)' }}
          >
            {busy ? 'Gerando QR Code...' : 'Conectar'}
          </button>
        )}
        {status === 'open' && (
          <button
            onClick={handleDisconnect}
            disabled={busy}
            className="rounded-xl px-4 py-2 text-sm font-semibold text-slate-300 transition-colors hover:bg-white/5 disabled:opacity-50"
            style={{ border: '1px solid rgba(255,255,255,0.08)' }}
          >
            {busy ? 'Desconectando...' : 'Desconectar'}
          </button>
        )}
      </div>
    </Card>
  )
}
