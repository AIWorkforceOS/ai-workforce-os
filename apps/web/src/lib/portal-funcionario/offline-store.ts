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

import { getStorageStatus, hasRoom } from './storage-quota'
import type { PortalAppointment } from './data'

const DB_NAME = 'alizo-portal-funcionario'
const DB_VERSION = 3
const STORE_NAME = 'pending_service_order_saves'
const DRAFT_STORE = 'service_order_drafts'
const SNAPSHOT_STORE = 'offline_snapshot'
const META_STORE = 'meta'

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
  /** Funcionário que criou o item (troca de usuário no mesmo aparelho): só é enviado quando esse mesmo funcionário está logado. Ausente = item antigo, enviado por quem estiver logado. */
  ownerId?: string
}

let activeOwner: string | null = null
/** Quem está logado agora (definido pelo layout do portal). */
export function setActiveOwner(employeeId: string | null): void {
  activeOwner = employeeId
}
export function getActiveOwner(): string | null {
  return activeOwner
}

let lastStoreFailure: 'quota' | 'other' | null = null
/** Por que o último addPendingSave não guardou (pra tela dizer "sem espaço" em vez de erro genérico). */
export function getLastStoreFailure(): 'quota' | 'other' | null {
  return lastStoreFailure
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
      // v3 (2026-10-17, PWA): agenda sincronizada por funcionário (abrir ordens sem internet) + metadados.
      // Aditivo: não toca a fila nem os rascunhos.
      if (!db.objectStoreNames.contains(SNAPSHOT_STORE)) {
        db.createObjectStore(SNAPSHOT_STORE, { keyPath: 'employeeId' })
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: 'key' })
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
  lastStoreFailure = null
  if (!isIndexedDbAvailable()) {
    lastStoreFailure = 'other'
    return null
  }
  try {
    // Antes de assumir que o arquivo foi salvo: confere se o aparelho tem espaço.
    const bytes = Object.values(input.files).reduce((sum, list) => sum + list.reduce((n, f) => n + f.blob.size, 0), 0)
    if (bytes > 0 && !hasRoom(await getStorageStatus(), bytes)) {
      lastStoreFailure = 'quota'
      return null
    }
    const db = await openDb()
    const item: PendingSave = { ...input, id: input.id ?? localId(), createdAt: Date.now(), ownerId: input.ownerId ?? activeOwner ?? undefined }
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).put(item)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
    db.close()
    return item.id
  } catch (error) {
    lastStoreFailure = (error as { name?: string })?.name === 'QuotaExceededError' ? 'quota' : 'other'
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
  /** Funcionário dono do rascunho (isolamento por usuário no mesmo aparelho). Ausente = rascunho antigo. */
  ownerId?: string
}

export async function saveDraft(draft: DraftRecord): Promise<boolean> {
  if (!isIndexedDbAvailable()) return false
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DRAFT_STORE, 'readwrite')
      tx.objectStore(DRAFT_STORE).put({ ...draft, ownerId: draft.ownerId ?? activeOwner ?? undefined })
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
    // Rascunho de outro funcionário NÃO é mostrado a quem está logado agora (mas também não é apagado).
    if (draft?.ownerId && activeOwner && draft.ownerId !== activeOwner) return null
    return draft
  } catch {
    return null
  }
}

/** Quantos rascunhos guardados (formulários preenchidos e ainda não enviados) o usuário atual tem neste aparelho. */
export async function countDrafts(): Promise<number> {
  const all = (await tx(DRAFT_STORE, 'readonly', (s) => s.getAll())) as DraftRecord[] | undefined
  return (all ?? []).filter((d) => !d.ownerId || !activeOwner || d.ownerId === activeOwner).length
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

// ---------------------------------------------------------------------------
// Agenda offline (PWA) — foto da agenda do funcionário, gravada a cada visita ONLINE ao portal.
// Só guarda o que o servidor já deixou esse funcionário ver; nunca de outro usuário.
// ---------------------------------------------------------------------------

export type OfflineSnapshot = {
  employeeId: string
  savedAt: number
  appointments: PortalAppointment[]
  timezone: string
  /** 'pt' | 'en' (idioma da unidade) */
  locale: string
  requiresCheckin: boolean
}

/**
 * Depois disto a agenda guardada NÃO é mais exibida offline (dado de consulta velho demais): precisa abrir online de novo.
 * Vale SÓ para consulta — nunca apaga nem bloqueia fila, rascunhos, fotos, vídeos, assinaturas ou marcos pendentes.
 */
export const SNAPSHOT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000

export function isSnapshotUsable(snapshot: Pick<OfflineSnapshot, 'savedAt'> | null, now = Date.now()): boolean {
  return Boolean(snapshot) && now - snapshot!.savedAt <= SNAPSHOT_MAX_AGE_MS
}

async function tx<T>(store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  if (!isIndexedDbAvailable()) return undefined
  try {
    const db = await openDb()
    const result = await new Promise<T | undefined>((resolve, reject) => {
      const t = db.transaction(store, mode)
      const request = run(t.objectStore(store))
      t.oncomplete = () => resolve(request.result)
      t.onerror = () => reject(t.error)
      t.onabort = () => reject(t.error)
    })
    db.close()
    return result
  } catch {
    return undefined
  }
}

export async function saveSnapshot(snapshot: OfflineSnapshot): Promise<boolean> {
  // Dados de CONSULTA de outro funcionário saem do aparelho quando este entra (isolamento por usuário).
  // Fila, rascunhos e marcos pendentes NUNCA são tocados aqui.
  const all = (await tx(SNAPSHOT_STORE, 'readonly', (s) => s.getAllKeys())) as IDBValidKey[] | undefined
  for (const key of all ?? []) if (key !== snapshot.employeeId) await tx(SNAPSHOT_STORE, 'readwrite', (s) => s.delete(key))
  const saved = await tx(SNAPSHOT_STORE, 'readwrite', (s) => s.put(snapshot))
  if (saved === undefined) return false
  await tx(META_STORE, 'readwrite', (s) => s.put({ key: 'active_owner', employeeId: snapshot.employeeId }))
  return true
}

/** Snapshot do último funcionário que abriu o portal online neste aparelho (é quem o modo offline mostra). */
export async function loadActiveSnapshot(): Promise<OfflineSnapshot | null> {
  const active = (await tx(META_STORE, 'readonly', (s) => s.get('active_owner'))) as { employeeId?: string } | undefined
  if (!active?.employeeId) return null
  return ((await tx(SNAPSHOT_STORE, 'readonly', (s) => s.get(active.employeeId!))) as OfflineSnapshot | undefined) ?? null
}

/** Ao sair da conta: apaga SÓ a agenda de consulta (a fila, os rascunhos e os marcos pendentes NÃO são apagados — nada pendente se perde). */
export async function clearSnapshots(): Promise<void> {
  await tx(SNAPSHOT_STORE, 'readwrite', (s) => s.clear())
  await tx(META_STORE, 'readwrite', (s) => s.delete('active_owner'))
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await tx(META_STORE, 'readwrite', (s) => s.put({ key, value }))
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const row = (await tx(META_STORE, 'readonly', (s) => s.get(key))) as { value?: T } | undefined
  return row?.value
}
