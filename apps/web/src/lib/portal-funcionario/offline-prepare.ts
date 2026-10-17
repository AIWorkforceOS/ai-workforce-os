import { extractStaticAssetUrls } from './offline-routes'
import { requestPersistentStorage, saveSnapshot, type OfflineSnapshot } from './offline-store'

export type PrepareResult = { ok: true; orders: number; shellFiles: number; savedAt: number } | { ok: false; reason: 'offline' | 'session' | 'error' }

/**
 * "Preparar para uso offline": (1) baixa a agenda e as ordens do técnico (as que o servidor deixa ele ver)
 * para o IndexedDB; (2) aquece o cache do código da casca offline (o Service Worker guarda); (3) pede ao
 * navegador para não apagar o armazenamento. Nunca promete ordens que não foram baixadas.
 */
export async function prepareForOffline(): Promise<PrepareResult> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { ok: false, reason: 'offline' }
  try {
    const response = await fetch('/api/portal-funcionario/offline-snapshot', { cache: 'no-store' })
    if (response.status === 401 || response.status === 403) return { ok: false, reason: 'session' }
    if (!response.ok) return { ok: false, reason: 'error' }
    const data = (await response.json()) as Omit<OfflineSnapshot, 'savedAt'>
    const snapshot: OfflineSnapshot = { ...data, savedAt: Date.now() }
    if (!(await saveSnapshot(snapshot))) return { ok: false, reason: 'error' }

    let shellFiles = 0
    try {
      const html = await (await fetch('/offline-app', { cache: 'no-store' })).text()
      for (const url of extractStaticAssetUrls(html)) {
        const asset = await fetch(url)
        if (asset.ok) shellFiles += 1
      }
    } catch {
      // casca não aquecida: a agenda continua gravada; o SW tenta de novo na próxima abertura online
    }
    void requestPersistentStorage()
    return { ok: true, orders: snapshot.appointments.length, shellFiles, savedAt: snapshot.savedAt }
  } catch {
    return { ok: false, reason: typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'error' }
  }
}
