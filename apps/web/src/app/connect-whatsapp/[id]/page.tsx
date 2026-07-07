'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'

type Status = 'idle' | 'loading' | 'connecting' | 'open' | 'error'

export default function ConnectWhatsAppPage() {
  const { id } = useParams<{ id: string }>()
  const [status, setStatus] = useState<Status>('idle')
  const [qrCode, setQrCode] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }

  async function checkStatus(): Promise<'open' | 'other'> {
    try {
      const res = await fetch(`/api/public/units/${id}/whatsapp/status`)
      const data = await res.json()
      if (data.status === 'open') {
        setStatus('open')
        setQrCode(null)
        stopPolling()
        return 'open'
      }
    } catch {
      // keep polling
    }
    return 'other'
  }

  async function startConnect() {
    setStatus('loading')
    setError(null)
    stopPolling()

    try {
      const res = await fetch(`/api/public/units/${id}/whatsapp/connect`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Erro ao gerar QR Code.')
        setStatus('error')
        return
      }
      setQrCode(data.qrCode ?? null)
      setStatus('connecting')
      pollRef.current = setInterval(checkStatus, 3000)
    } catch {
      setError('Não foi possível conectar. Tente novamente.')
      setStatus('error')
    }
  }

  useEffect(() => {
    startConnect()
    return stopPolling
  }, [id])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
        {/* Header */}
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
            <svg viewBox="0 0 24 24" className="h-7 w-7 fill-green-600">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
              <path d="M12 0C5.373 0 0 5.373 0 12c0 2.124.558 4.118 1.532 5.845L.057 23.492a.5.5 0 0 0 .614.612l5.757-1.51A11.943 11.943 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.907 0-3.694-.522-5.224-1.43l-.374-.222-3.868 1.015 1.032-3.77-.242-.388A9.953 9.953 0 0 1 2 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z" />
            </svg>
          </div>
          <h1 className="text-lg font-semibold text-gray-900">Conectar WhatsApp</h1>
          <p className="text-sm text-gray-500">
            Escaneie o QR Code abaixo com o WhatsApp do chip desta unidade.
          </p>
        </div>

        {/* Content area */}
        {status === 'loading' && (
          <div className="flex flex-col items-center gap-3 py-8">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-gray-900" />
            <p className="text-sm text-gray-500">Gerando QR Code...</p>
          </div>
        )}

        {(status === 'connecting' || status === 'idle') && qrCode && (
          <div className="flex flex-col items-center gap-4">
            <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
              <img
                src={qrCode.startsWith('data:') ? qrCode : `data:image/png;base64,${qrCode}`}
                alt="QR Code WhatsApp"
                className="h-56 w-56"
              />
            </div>
            <p className="text-center text-xs text-gray-400">
              Abra o WhatsApp → Aparelhos conectados → Conectar aparelho
            </p>
            <button
              onClick={startConnect}
              className="text-xs text-gray-500 underline hover:text-gray-700"
            >
              Gerar novo QR Code
            </button>
          </div>
        )}

        {status === 'open' && (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-100">
              <svg className="h-7 w-7 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="font-semibold text-gray-900">WhatsApp conectado!</p>
            <p className="text-sm text-gray-500">
              Esta unidade está pronta para enviar e receber mensagens.
            </p>
          </div>
        )}

        {status === 'error' && (
          <div className="flex flex-col items-center gap-4 py-4 text-center">
            <p className="text-sm text-red-600">{error}</p>
            <button
              onClick={startConnect}
              className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
            >
              Tentar novamente
            </button>
          </div>
        )}
      </div>

      <p className="mt-6 text-xs text-gray-400">AI Workforce OS</p>
    </div>
  )
}
