'use client'

import { useState } from 'react'
import { Camera } from 'lucide-react'
import { requestCameraAccess } from '@/lib/portal-funcionario/camera-access'
import { rememberCameraDenied, useCameraPermission } from '@/lib/portal-funcionario/use-camera-permission'

/**
 * Só aparece quando o navegador ainda PODE perguntar ("prompt"): um botão,
 * um toque, o celular pergunta "Permitir?". Se a câmera já foi bloqueada, o
 * navegador não deixa perguntar de novo — então o aviso some e o técnico usa
 * "Tirar foto"/"Gravar vídeo" (câmera do celular, sem permissão nenhuma).
 */
export function CameraPermissionGate() {
  const permission = useCameraPermission()
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)

  if (done || permission !== 'prompt') return null

  async function allow() {
    setBusy(true)
    const result = await requestCameraAccess({ audio: true })
    setBusy(false)
    if (result.ok) rememberCameraDenied(false)
    else if (result.reason === 'denied') rememberCameraDenied(true)
    setDone(true)
  }

  return (
    <button
      type="button"
      onClick={allow}
      disabled={busy}
      className="flex w-fit items-center gap-2 rounded-xl px-4 py-3 text-sm font-bold text-black disabled:opacity-60"
      style={{ background: '#f59e0b' }}
    >
      <Camera size={16} />
      {busy ? 'Aguardando…' : 'Permitir câmera do app (1 toque)'}
    </button>
  )
}
