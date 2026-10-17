export type GeoFix = { lat: number; lng: number; accuracy: number; at: string }
export type GeoFailure = 'denied' | 'unavailable' | 'timeout' | 'unsupported'
export type GeoPermission = 'granted' | 'prompt' | 'denied' | 'unknown'

export async function queryGeoPermission(): Promise<GeoPermission> {
  try {
    if (typeof navigator === 'undefined' || !navigator.permissions?.query) return 'unknown'
    const status = await navigator.permissions.query({ name: 'geolocation' as PermissionName })
    return status.state === 'granted' || status.state === 'denied' || status.state === 'prompt' ? status.state : 'unknown'
  } catch {
    return 'unknown'
  }
}

export function classifyGeoError(error: { code?: number } | null | undefined): GeoFailure {
  if (error?.code === 1) return 'denied'
  if (error?.code === 3) return 'timeout'
  return 'unavailable'
}

/**
 * Pega UMA posição agora (é essa chamada que faz o celular perguntar "Permitir
 * localização?"). Alta precisão ligada. Sem posição = o chamador NÃO avança.
 */
export function getCurrentFix(options: { timeoutMs?: number } = {}): Promise<{ ok: true; fix: GeoFix } | { ok: false; reason: GeoFailure }> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve({ ok: false, reason: 'unsupported' })
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          ok: true,
          fix: { lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy, at: new Date(position.timestamp || Date.now()).toISOString() },
        }),
      (error) => resolve({ ok: false, reason: classifyGeoError(error) }),
      { enableHighAccuracy: true, timeout: options.timeoutMs ?? 20_000, maximumAge: 0 },
    )
  })
}

/** Acompanha a posição enquanto a tela está aberta (só para mostrar "GPS ativo ±Xm"). Devolve a função que para. */
export function watchFix(onFix: (fix: GeoFix) => void, onError?: (reason: GeoFailure) => void): () => void {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return () => {}
  const id = navigator.geolocation.watchPosition(
    (position) => onFix({ lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy, at: new Date(position.timestamp || Date.now()).toISOString() }),
    (error) => onError?.(classifyGeoError(error)),
    { enableHighAccuracy: true, maximumAge: 10_000, timeout: 30_000 },
  )
  return () => navigator.geolocation.clearWatch(id)
}

export function geoHelp(reason: GeoFailure, userAgent: string): string {
  const ios = /iPhone|iPad|iPod/i.test(userAgent)
  if (reason === 'denied') {
    return ios
      ? 'A localização está bloqueada para este site. Toque em "aA" na barra do endereço → Ajustes do Site → Localização → Permitir. Depois toque em "Tentar de novo".'
      : 'A localização está bloqueada para este site. Toque no cadeado ao lado do endereço → Permissões → Localização → Permitir. Depois toque em "Tentar de novo".'
  }
  if (reason === 'timeout') return 'Não achamos sua posição a tempo. Vá para um lugar aberto, confirme que o GPS do celular está ligado e tente de novo.'
  if (reason === 'unsupported') return 'Este navegador não informa a localização. Abra o app pelo Chrome (Android) ou Safari (iPhone).'
  return 'Não conseguimos obter sua posição. Ligue o GPS do celular e tente de novo.'
}

const GEO_OK_KEY = 'alizo_geo_ok'

/** Lembra neste aparelho que a localização já foi liberada (Safari nem sempre deixa consultar o estado). */
export function rememberGeoGranted(granted: boolean): void {
  try {
    if (granted) localStorage.setItem(GEO_OK_KEY, '1')
    else localStorage.removeItem(GEO_OK_KEY)
  } catch {}
}

export function geoGrantedBefore(): boolean {
  try {
    return localStorage.getItem(GEO_OK_KEY) === '1'
  } catch {
    return false
  }
}
