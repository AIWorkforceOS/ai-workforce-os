import { countPendingSaves } from './offline-store'

/** Interruptor de segurança: NEXT_PUBLIC_PWA_ENABLED=false desliga o PWA — o app se desregistra e apaga só os caches "alizo-*" (nunca o IndexedDB). */
export const PWA_ENABLED = process.env.NEXT_PUBLIC_PWA_ENABLED !== 'false'

export async function unregisterServiceWorkers(): Promise<void> {
  try {
    const registrations = await navigator.serviceWorker.getRegistrations()
    await Promise.all(registrations.map((r) => r.unregister()))
    for (const name of await caches.keys()) if (name.startsWith('alizo-')) await caches.delete(name)
  } catch {
    // sem SW/caches: nada a desfazer
  }
}

/** Versão nova do SW só assume quando NÃO há itens pendentes na fila (atualização controlada). */
export async function activateWaitingWorkerIfSafe(registration: ServiceWorkerRegistration): Promise<boolean> {
  if (!registration.waiting) return false
  if ((await countPendingSaves()) > 0) return false
  registration.waiting.postMessage({ type: 'SKIP_WAITING' })
  return true
}

export async function registerServiceWorker(): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  if (!PWA_ENABLED) return unregisterServiceWorkers()
  try {
    const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
    const check = () => void activateWaitingWorkerIfSafe(registration)
    registration.addEventListener('updatefound', () => registration.installing?.addEventListener('statechange', check))
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        void registration.update().catch(() => {})
        check()
      }
    })
    check()
    // aquece a casca offline uma vez por dia (online)
    const last = Number(localStorage.getItem('alizo_shell_warm_at') ?? 0)
    if (navigator.onLine && Date.now() - last > 24 * 3600 * 1000) {
      const { prepareForOffline } = await import('./offline-prepare')
      const result = await prepareForOffline()
      if (result.ok) localStorage.setItem('alizo_shell_warm_at', String(Date.now()))
    }
  } catch {
    // registro falhou: o app segue normal, só sem o modo offline da casca
  }
}
