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
const DB_VERSION = 2
const STORE_NAME = 'pending_service_order_saves'
const DRAFT_STORE = 'service_order_drafts'

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
  /** 'failed' = o servidor recusou de um jeito que repetir não resolve (ex.: ordem removida) — NUNCA é apagado sozinho, fica visível na tela de sincronização pro técnico/admin decidir. Ausente = 'pending'. */
  status?: 'pending' | 'failed'
  attempts?: number
  /** Só tenta de novo depois deste instante (backoff); 'tentar agora' manual ignora. */
  nextAttemptAt?: number
  lastError?: string
  lastHttpStatus?: number
  /** Arquivos já enviados com sucesso quando o salvamento foi fatiado (chave `${campo}:${posição}`) — evita reenviar tudo depois de uma falha no meio. */
  sentFiles?: string[]
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
      // v2 (2026-10-16): rascunho do formulário por ordem — aditivo, não toca a fila existente.
      if (!db.objectStoreNames.contains(DRAFT_STORE)) {
        db.createObjectStore(DRAFT_STORE, { keyPath: 'appointmentId' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/** Gera um id local sem depender de crypto.randomUUID (nem todo WebView antigo tem). */
export function localId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export async function addPendingSave(input: Omit<PendingSave, 'id' | 'createdAt'> & { id?: string }): Promise<string | null> {
  if (!isIndexedDbAvailable()) return null
  try {
    const db = await openDb()
    const item: PendingSave = { ...input, id: input.id ?? localId(), createdAt: Date.now() }
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

export async function updatePendingSave(id: string, patch: Partial<PendingSave>): Promise<void> {
  if (!isIndexedDbAvailable()) return
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      const getRequest = store.get(id)
      getRequest.onsuccess = () => {
        const current = getRequest.result as PendingSave | undefined
        if (current) store.put({ ...current, ...patch, id: current.id })
      }
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  } catch {
    // não conseguir atualizar o estado nunca pode apagar o item — ele continua na fila como estava.
  }
}

/**
 * Pede ao navegador pra não apagar o armazenamento local deste app por
 * falta de espaço/inatividade (navigator.storage.persist). Chrome/Android
 * decide sozinho (sem prompt); Safari/iOS tende a conceder quando o site
 * está instalado na tela inicial. É pedido, não garantia — por isso a fila
 * sempre mostra o que ainda não sincronizou.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false
    if (await navigator.storage.persisted?.()) return true
    return await navigator.storage.persist()
  } catch {
    return false
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

/**
 * Rascunho do formulário da ordem (campos, fotos, assinatura) guardado no
 * aparelho enquanto o técnico trabalha — antes, tudo isso vivia só na
 * memória da página e recarregar/fechar/iOS matar a aba perdia tudo.
 * Apagado quando o salvamento é confirmado ou vira item da fila offline.
 */
export type DraftRecord = {
  appointmentId: string
  unitId: string
  updatedAt: number
  fields: Record<string, string>
  signatureDataUrl: string | null
  files: Record<string, StoredFile[]>
}

export async function saveDraft(draft: DraftRecord): Promise<boolean> {
  if (!isIndexedDbAvailable()) return false
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DRAFT_STORE, 'readwrite')
      tx.objectStore(DRAFT_STORE).put(draft)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
    db.close()
    return true
  } catch {
    return false
  }
}

export async function loadDraft(appointmentId: string): Promise<DraftRecord | null> {
  if (!isIndexedDbAvailable()) return null
  try {
    const db = await openDb()
    const draft = await new Promise<DraftRecord | null>((resolve, reject) => {
      const request = db.transaction(DRAFT_STORE, 'readonly').objectStore(DRAFT_STORE).get(appointmentId)
      request.onsuccess = () => resolve((request.result as DraftRecord | undefined) ?? null)
      request.onerror = () => reject(request.error)
    })
    db.close()
    return draft
  } catch {
    return null
  }
}

export async function deleteDraft(appointmentId: string): Promise<void> {
  if (!isIndexedDbAvailable()) return
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DRAFT_STORE, 'readwrite')
      tx.objectStore(DRAFT_STORE).delete(appointmentId)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  } catch {
    // rascunho velho que sobra é inofensivo — no máximo reaparece preenchido.
  }
}
