/**
 * Fila local (IndexedDB) de salvamentos que falharam por falta de
 * internet — pedido do Vinicius (2026-09-15): "quando for coletado uma
 * assinatura e fotos isso nunca seja perdido mesmo se não tiver
 * conexão com a internet no momento". Guarda exatamente o que seria
 * mandado pro servidor (campos + arquivos), pra reenviar depois sem
 * precisar que o técnico volte pra aquela ordem específica.
 *
 * Puro client-side (indexedDB só existe no navegador) — toda função
 * aqui é segura de chamar em qualquer ambiente: se o navegador não tem
 * suporte (raro, algum WebView restrito), falha em silêncio e quem
 * chamou trata como "não deu pra guardar localmente".
 */

const DB_NAME = 'alizo-portal-funcionario'
const DB_VERSION = 1
const STORE_NAME = 'pending_service_order_saves'

export type StoredFile = { blob: Blob; name: string; type: string }

export type PendingSave = {
  id: string
  unitId: string
  appointmentId: string
  createdAt: number
  /** Campos de texto do FormData original (status, signedBy, etc.) — mesma forma que a rota PATCH já espera. */
  fields: Record<string, string>
  /** Arquivos por nome de campo do FormData (photosBefore, photosAfter, materialPhotos, signature). */
  files: Record<string, StoredFile[]>
}

function isIndexedDbAvailable(): boolean {
  return typeof indexedDB !== 'undefined'
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/** Gera um id local sem depender de crypto.randomUUID (nem todo WebView antigo tem). */
function localId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export async function addPendingSave(input: Omit<PendingSave, 'id' | 'createdAt'>): Promise<string | null> {
  if (!isIndexedDbAvailable()) return null
  try {
    const db = await openDb()
    const item: PendingSave = { ...input, id: localId(), createdAt: Date.now() }
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).put(item)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
    return item.id
  } catch {
    return null
  }
}

export async function deletePendingSave(id: string): Promise<void> {
  if (!isIndexedDbAvailable()) return
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).delete(id)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  } catch {
    // se não der pra apagar, a próxima sincronização tenta de novo — não é crítico.
  }
}

export async function listPendingSaves(): Promise<PendingSave[]> {
  if (!isIndexedDbAvailable()) return []
  try {
    const db = await openDb()
    const items = await new Promise<PendingSave[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const request = tx.objectStore(STORE_NAME).getAll()
      request.onsuccess = () => resolve(request.result as PendingSave[])
      request.onerror = () => reject(request.error)
    })
    db.close()
    return items.sort((a, b) => a.createdAt - b.createdAt)
  } catch {
    return []
  }
}

export async function countPendingSaves(): Promise<number> {
  return (await listPendingSaves()).length
}
