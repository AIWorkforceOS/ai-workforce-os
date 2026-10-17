'use client'

import { useEffect, useState } from 'react'
import { queryCameraPermission, type CameraPermission } from './camera-access'

const DENIED_KEY = 'alizo_camera_denied'

/** Lembra neste aparelho que a câmera embutida foi bloqueada (Safari não deixa consultar). */
export function rememberCameraDenied(denied: boolean): void {
  try {
    if (denied) localStorage.setItem(DENIED_KEY, '1')
    else localStorage.removeItem(DENIED_KEY)
  } catch {}
}

function rememberedDenied(): boolean {
  try {
    return localStorage.getItem(DENIED_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * Estado da permissão da câmera EMBUTIDA no app (câmera contínua / gravador de 15s).
 * 'denied' => esconder essas opções: o técnico usa a câmera do próprio celular
 * ("Tirar foto"/"Gravar vídeo"), que não depende de permissão nenhuma.
 */
export function useCameraPermission(): CameraPermission {
  const [state, setState] = useState<CameraPermission>('unknown')
  useEffect(() => {
    let cancelled = false
    queryCameraPermission().then((permission) => {
      if (cancelled) return
      if (permission === 'granted') rememberCameraDenied(false)
      setState(permission === 'denied' || (permission === 'unknown' && rememberedDenied()) ? 'denied' : permission)
    })
    return () => {
      cancelled = true
    }
  }, [])
  return state
}
