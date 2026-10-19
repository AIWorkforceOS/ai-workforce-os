import { activateWaitingWorkerIfSafe } from './sw-register'

/**
 * "Atualizar o app": no app instalado não existe botão de recarregar do navegador. Procura versão nova do app, ativa se for seguro
 * (sem itens pendentes na fila) e recarrega a tela. A fila de envios, os rascunhos e as fotos guardadas ficam no aparelho e NÃO são tocados.
 */
export type RefreshDeps = {
  countPending: () => Promise<number>
  getRegistration: () => Promise<Pick<ServiceWorkerRegistration, 'update' | 'waiting'> | undefined>
  activate: (registration: Pick<ServiceWorkerRegistration, 'waiting'>) => Promise<boolean>
  confirm: (message: string) => boolean
  reload: () => void
  sleep: (ms: number) => Promise<void>
}

export async function refreshApp(deps: RefreshDeps): Promise<'reloaded' | 'cancelled'> {
  let pending = 0
  try {
    pending = await deps.countPending()
  } catch {
    // sem IndexedDB: segue
  }
  if (pending > 0 && !deps.confirm(`Há ${pending} item(ns) aguardando envio neste aparelho. Eles continuam guardados e seguem sendo enviados depois de atualizar. Atualizar agora?`)) return 'cancelled'
  try {
    const registration = await deps.getRegistration()
    if (registration) {
      await registration.update().catch(() => undefined)
      if (pending === 0) await deps.activate(registration as ServiceWorkerRegistration).catch(() => false)
    }
  } catch {
    // sem service worker: o recarregar abaixo já busca a versão nova (as páginas vêm sempre da rede)
  }
  await deps.sleep(400)
  deps.reload()
  return 'reloaded'
}

export function browserRefreshDeps(countPending: () => Promise<number>): RefreshDeps {
  return {
    countPending,
    getRegistration: async () => (typeof navigator !== 'undefined' && 'serviceWorker' in navigator ? navigator.serviceWorker.getRegistration() : undefined),
    activate: (registration) => activateWaitingWorkerIfSafe(registration as ServiceWorkerRegistration),
    confirm: (message) => window.confirm(message),
    reload: () => window.location.reload(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  }
}
