'use client'

import { useEffect, useState } from 'react'
import { Camera } from 'lucide-react'
import { cameraHelp, queryCameraPermission, requestCameraAccess, type CameraFailure } from '@/lib/portal-funcionario/camera-access'

const OK_KEY = 'alizo_camera_ok'

/**
 * Pede a permissão da câmera/microfone logo de cara, com um botão claro,
 * em vez de o técnico só descobrir o bloqueio na hora de fotografar.
 * Quando já está bloqueada, mostra o passo a passo exato por aparelho.
 */
export function CameraPermissionGate() {
  const [state, setState] = useState<'hidden' | 'ask' | 'denied'>('hidden')
  const [failure, setFailure] = useState<CameraFailure | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    queryCameraPermission().then((permission) => {
      if (cancelled) return
      if (permission === 'granted') return setState('hidden')
      if (permission === 'denied') return setState('denied')
      let already = false
      try {
        already = localStorage.getItem(OK_KEY) === '1'
      } catch {}
      // 'prompt' → pede; 'unknown' (Safari) → pede só até conceder uma vez neste aparelho
      setState(permission === 'prompt' || !already ? 'ask' : 'hidden')
    })
    return () => {
      cancelled = true
    }
  }, [])

  async function allow() {
    setBusy(true)
    const result = await requestCameraAccess({ audio: true })
    setBusy(false)
    if (result.ok) {
      try {
        localStorage.setItem(OK_KEY, '1')
      } catch {}
      setState('hidden')
      setFailure(null)
    } else {
      setFailure(result.reason)
      setState(result.reason === 'denied' ? 'denied' : 'ask')
    }
  }

  if (state === 'hidden') return null

  return (
    <div className="flex flex-col gap-2 rounded-2xl p-4" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)' }}>
      <p className="flex items-center gap-2 text-sm font-bold text-amber-200">
        <Camera size={15} />
        {state === 'denied' ? 'A câmera está bloqueada neste aparelho' : 'Ative a câmera para tirar fotos e gravar vídeos'}
      </p>
      {state === 'ask' && !failure && (
        <p className="text-xs text-slate-300">Toque no botão e, quando o celular perguntar, escolha <b>Permitir</b> (câmera e microfone).</p>
      )}
      {failure && <p className="text-xs text-amber-100">{cameraHelp(failure, navigator.userAgent)}</p>}
      {state === 'denied' && !failure && <p className="text-xs text-amber-100">{cameraHelp('denied', navigator.userAgent)}</p>}
      <button
        type="button"
        onClick={allow}
        disabled={busy}
        className="w-fit rounded-lg px-3 py-2 text-xs font-bold text-black disabled:opacity-60"
        style={{ background: '#f59e0b' }}
      >
        {busy ? 'Aguardando…' : state === 'denied' ? 'Já liberei — tentar de novo' : 'Permitir câmera'}
      </button>
    </div>
  )
}
