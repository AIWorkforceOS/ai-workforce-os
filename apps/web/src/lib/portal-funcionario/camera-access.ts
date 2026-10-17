export type CameraPermission = 'granted' | 'prompt' | 'denied' | 'unknown'
export type CameraFailure = 'denied' | 'in_use' | 'not_found' | 'unsupported' | 'error'

/** Estado da permissão da câmera quando o navegador deixa consultar (Chrome/Android sim; Safari/iPhone costuma não). */
export async function queryCameraPermission(): Promise<CameraPermission> {
  try {
    if (typeof navigator === 'undefined' || !navigator.permissions?.query) return 'unknown'
    const status = await navigator.permissions.query({ name: 'camera' as PermissionName })
    return status.state === 'granted' || status.state === 'denied' || status.state === 'prompt' ? status.state : 'unknown'
  } catch {
    return 'unknown'
  }
}

export function classifyCameraError(error: unknown): CameraFailure {
  const name = (error as { name?: string } | null)?.name ?? ''
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') return 'denied'
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') return 'in_use'
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') return 'not_found'
  return 'error'
}

/**
 * Abre a câmera (e o microfone, se for gravar vídeo). É esta chamada que faz o
 * navegador mostrar o aviso "Permitir câmera?". Se as restrições de qualidade
 * forem recusadas, tenta de novo com restrições simples (qualquer câmera).
 */
export async function openCameraStream(
  options: { audio?: boolean; video?: MediaTrackConstraints } = {},
): Promise<{ ok: true; stream: MediaStream } | { ok: false; reason: CameraFailure }> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return { ok: false, reason: 'unsupported' }
  const attempts: MediaStreamConstraints[] = [
    { video: options.video ?? { facingMode: { ideal: 'environment' } }, audio: Boolean(options.audio) },
    { video: true, audio: Boolean(options.audio) },
  ]
  let last: CameraFailure = 'error'
  for (const constraints of attempts) {
    try {
      return { ok: true, stream: await navigator.mediaDevices.getUserMedia(constraints) }
    } catch (error) {
      last = classifyCameraError(error)
      if (last === 'denied' || last === 'in_use') break
    }
  }
  return { ok: false, reason: last }
}

/** Pede a permissão agora e libera a câmera em seguida — serve só para conceder o acesso de cara. */
export async function requestCameraAccess(options: { audio?: boolean } = {}): Promise<{ ok: true } | { ok: false; reason: CameraFailure }> {
  const result = await openCameraStream(options)
  if (!result.ok) return result
  result.stream.getTracks().forEach((track) => track.stop())
  return { ok: true }
}

/** Texto de ajuda por falha e por aparelho — o técnico precisa saber exatamente onde tocar. */
export function cameraHelp(reason: CameraFailure, userAgent: string): string {
  const ios = /iPhone|iPad|iPod/i.test(userAgent)
  if (reason === 'denied') {
    return ios
      ? 'A câmera está bloqueada. No iPhone: toque em "aA" na barra do endereço → Ajustes do Site → Câmera → Permitir (e Microfone para vídeo). Depois recarregue a página.'
      : 'A câmera está bloqueada. No Android: toque no cadeado ao lado do endereço → Permissões → Câmera → Permitir (e Microfone para vídeo). Depois recarregue a página.'
  }
  if (reason === 'in_use') return 'A câmera está em uso por outro app ou outra aba. Feche-os e tente de novo.'
  if (reason === 'not_found') return 'Nenhuma câmera foi encontrada neste aparelho.'
  if (reason === 'unsupported') return 'Este navegador não abre a câmera dentro do app. Use o botão "Escolher / tirar foto".'
  return 'Não foi possível abrir a câmera. Tente de novo ou use o botão "Escolher / tirar foto".'
}
