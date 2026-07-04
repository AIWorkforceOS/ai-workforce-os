'use client'

import { useEffect, useRef, useState } from 'react'

type Status = 'open' | 'connecting' | 'close' | 'not_configured' | 'error' | 'loading'

const STATUS_LABEL: Record<Status, string> = {
  open: 'Conectado',
  connecting: 'Conectando...',
  close: 'Desconectado',
  not_configured: 'Sem configuração',
  error: 'Erro ao verificar status',
  loading: 'Verificando...',
}

const STATUS_COLOR: Record<Status, string> = {
  open: 'bg-green-100 text-green-700',
  connecting: 'bg-amber-100 text-amber-700',
  close: 'bg-gray-100 text-gray-600',
  not_configured: 'bg-gray-100 text-gray-500',
  error: 'bg-red-100 text-red-700',
  loading: 'bg-gray-100 text-gray-500',
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
    <div className="flex flex-col gap-4 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">WhatsApp</h2>
          <p className="mt-1 text-sm text-gray-500">Conecte o número desta unidade via Evolution API.</p>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[status]}`}>
          {STATUS_LABEL[status]}
        </span>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {status === 'not_configured' && (
        <p className="text-sm text-gray-500">
          Preencha os campos da Evolution API acima e salve para poder conectar o WhatsApp.
        </p>
      )}

      {qrCode && (
        <div className="flex flex-col items-center gap-2 rounded-md border border-gray-100 bg-gray-50 p-4">
          <img
            src={qrCode.startsWith('data:') ? qrCode : `data:image/png;base64,${qrCode}`}
            alt="QR Code do WhatsApp"
            className="h-56 w-56"
          />
          <p className="text-xs text-gray-500">Escaneie com o WhatsApp da unidade.</p>
        </div>
      )}

      <div className="flex gap-3">
        {status !== 'open' && status !== 'not_configured' && (
          <button
            onClick={handleConnect}
            disabled={busy}
            className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-700 disabled:opacity-50"
          >
            {busy ? 'Gerando QR Code...' : 'Conectar'}
          </button>
        )}
        {status === 'open' && (
          <button
            onClick={handleDisconnect}
            disabled={busy}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 disabled:opacity-50"
          >
            {busy ? 'Desconectando...' : 'Desconectar'}
          </button>
        )}
      </div>
    </div>
  )
}
