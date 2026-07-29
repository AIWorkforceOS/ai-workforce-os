'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, Loader2, Smartphone, Wifi } from 'lucide-react'

// Passo de conexão do WhatsApp via QR code — extraído do wizard de
// onboarding do Sales Rep (components/onboarding/wizard.tsx) pra ser
// reaproveitado por qualquer fluxo guiado de contratação (ver hire-wizard.tsx).
// Comportamento idêntico ao original: gera QR, faz polling do status e
// avisa o pai quando conectar.

const whatsGradient = 'linear-gradient(135deg, #25d366, #128c7e)'

type WhatsStatus = 'open' | 'connecting' | 'close' | 'not_configured' | 'error' | 'loading'

export function WhatsAppConnectStep({
  unitId,
  alreadyConnected,
  onConnected,
  connectedHint = 'Seu número já está ligado à plataforma.',
}: {
  unitId: string
  alreadyConnected: boolean
  onConnected: () => void
  /** texto abaixo de "WhatsApp conectado!" — customizável por quem chama (ex.: próximo passo do fluxo) */
  connectedHint?: string
}) {
  const [status, setStatus] = useState<WhatsStatus>(alreadyConnected ? 'open' : 'loading')
  const [qrCode, setQrCode] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  async function fetchStatus(): Promise<WhatsStatus> {
    try {
      const res = await fetch(`/api/units/${unitId}/whatsapp/status`)
      const data = await res.json()
      const s: WhatsStatus = res.ok ? data.status : 'error'
      setStatus(s)
      return s
    } catch {
      setStatus('error')
      return 'error'
    }
  }

  useEffect(() => {
    fetchStatus()
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [unitId]) // fetchStatus é estável por render; refetch só quando muda a unidade

  async function handleConnect() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/units/${unitId}/whatsapp/connect`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Não foi possível gerar o QR code agora. Tente de novo em instantes.')
        setBusy(false)
        return
      }
      setQrCode(data.qrCode ?? null)
      setStatus('connecting')
      if (pollRef.current) clearInterval(pollRef.current)
      pollRef.current = setInterval(async () => {
        const current = await fetchStatus()
        if (current === 'open') {
          setQrCode(null)
          if (pollRef.current) clearInterval(pollRef.current)
          onConnected()
        }
      }, 3000)
    } catch {
      setError('Não foi possível iniciar a conexão. Verifique sua internet e tente de novo.')
    }
    setBusy(false)
  }

  if (status === 'open') {
    return (
      <div className="flex flex-col items-center gap-4 py-6 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full" style={{ background: whatsGradient, boxShadow: '0 0 30px rgba(37,211,102,0.35)' }}>
          <Check size={28} className="text-white" />
        </div>
        <div>
          <h3 className="text-lg font-black text-white">WhatsApp conectado!</h3>
          <p className="mt-1 text-sm text-slate-400">
            {connectedHint}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <p className="text-sm leading-relaxed text-slate-300">
        <strong className="text-white">Por que isso?</strong> É pelo seu WhatsApp que o funcionário
        digital vai conversar com seus clientes. A conexão é igual à do WhatsApp Web: você escaneia
        um QR code uma única vez, com o celular que tem o número da empresa.
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-3">
          {[
            { n: 1, text: 'Pegue o celular com o WhatsApp da empresa' },
            { n: 2, text: 'Abra WhatsApp → Configurações → Dispositivos conectados' },
            { n: 3, text: 'Toque em "Conectar dispositivo"' },
            { n: 4, text: 'Aponte a câmera pro QR code aqui do lado' },
          ].map(({ n, text }) => (
            <div key={n} className="flex items-start gap-3">
              <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-black text-white" style={{ background: whatsGradient }}>
                {n}
              </div>
              <p className="text-sm text-slate-300">{text}</p>
            </div>
          ))}
        </div>

        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl p-5" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
          {qrCode ? (
            <>
              <img
                src={qrCode.startsWith('data:') ? qrCode : `data:image/png;base64,${qrCode}`}
                alt="QR Code para conectar o WhatsApp"
                className="h-52 w-52 rounded-lg bg-white p-2"
              />
              <p className="text-center text-xs text-slate-400">
                Escaneie com o celular da empresa.<br />Assim que conectar, esta tela atualiza sozinha.
              </p>
            </>
          ) : (
            <>
              <Smartphone size={40} className="text-slate-600" />
              <button
                onClick={handleConnect}
                disabled={busy}
                className="flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-black text-white disabled:opacity-60"
                style={{ background: whatsGradient, boxShadow: '0 4px 12px rgba(37,211,102,0.25)' }}
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Wifi size={14} />}
                {busy ? 'Gerando QR code...' : 'Gerar QR code'}
              </button>
              {status === 'connecting' && <p className="text-xs text-amber-400">Aguardando você escanear…</p>}
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-xl px-4 py-3" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
          <p className="text-sm text-red-400">{error}</p>
          <p className="mt-1 text-xs text-slate-500">
            Se o problema continuar, pode pular este passo e conectar depois — ou fale com a gente em suporte@alizo.com.br.
          </p>
        </div>
      )}
    </div>
  )
}
