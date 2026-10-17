export type OfflineTarget = { view: 'agenda' } | { view: 'sync' } | { view: 'order'; appointmentId: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Caminho que o técnico tentou abrir (guardado pelo Service Worker em ?to=) → o que a casca offline deve mostrar. Só caminhos do portal; qualquer outra coisa cai na agenda. */
export function parseOfflineTarget(to: string | null | undefined): OfflineTarget {
  const path = (to ?? '').split('?')[0]?.replace(/\/+$/, '') ?? ''
  if (path === '/portal-funcionario/sincronizacao') return { view: 'sync' }
  const match = path.match(/^\/portal-funcionario\/ordem\/([^/]+)$/)
  if (match && UUID.test(match[1]!)) return { view: 'order', appointmentId: match[1]! }
  return { view: 'agenda' }
}

/** Endereços de código/estilo (/_next/static/...) que uma página HTML referencia — usado para aquecer o cache da casca offline. */
export function extractStaticAssetUrls(html: string): string[] {
  const found = new Set<string>()
  for (const match of html.matchAll(/\/_next\/static\/[^"'\\\s)<>]+\.(?:js|css)/g)) found.add(match[0])
  return Array.from(found)
}

export type InstallReadiness = { ready: boolean; reasons: string[] }

/**
 * "Posso trocar o ícone do Safari pelo app instalado?" — o armazenamento do Safari é separado do app
 * da tela inicial no iPhone: tudo que ainda estiver aqui (fila, erros, rascunhos) NÃO aparece no app novo.
 * Só fica pronto com tudo zerado.
 */
export function installReadiness(input: { pendingItems: number; failedItems: number; drafts: number; online: boolean }): InstallReadiness {
  const reasons: string[] = []
  if (!input.online) reasons.push('Sem internet agora — conecte-se para confirmar que tudo foi enviado.')
  if (input.pendingItems > 0) reasons.push(`${input.pendingItems} item(ns) ainda aguardando envio.`)
  if (input.failedItems > 0) reasons.push(`${input.failedItems} item(ns) com erro que precisam de atenção.`)
  if (input.drafts > 0) reasons.push(`${input.drafts} rascunho(s) de ordem ainda não enviados (abra a ordem e salve, ou confirme que não precisa).`)
  return { ready: reasons.length === 0, reasons }
}

export function isStandaloneDisplay(): boolean {
  try {
    if (typeof window === 'undefined') return false
    return window.matchMedia?.('(display-mode: standalone)').matches === true || (navigator as unknown as { standalone?: boolean }).standalone === true
  } catch {
    return false
  }
}
