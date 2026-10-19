import { directMediaUploadEnabled, isMediaField, registerMediaBatch, uploadMediaFile, type UploadedMedia } from './media-upload'
import { deletePendingSave, getActiveOwner, listPendingSaves, setMeta, updatePendingSave, type PendingSave } from './offline-store'

/**
 * Reenvia salvamentos guardados no aparelho pra mesma rota PATCH de sempre
 * (app/api/units/[id]/appointments/[appointmentId]/service-order/route.ts).
 *
 * REGRA DE OURO (pedido do Vinicius, 2026-10-16, etapa de confiabilidade):
 * esta fila NUNCA apaga um item por causa de erro. Só é apagado quando o
 * servidor confirma o salvamento (2xx). Antes, qualquer resposta não-2xx
 * (sessão expirada, foto grande demais, falha momentânea do servidor)
 * descartava assinatura e fotos em definitivo e em silêncio.
 *
 *  - rede caiu / 5xx / 408 / 425: mantém, tenta de novo com backoff.
 *  - 401: sessão expirou — mantém e espera o técnico entrar de novo (nada se perde).
 *  - 429: respeita Retry-After.
 *  - 413: corpo grande demais — o salvamento é FATIADO (uma foto por
 *    requisição, depois os campos + assinatura) e reenviado.
 *  - 400/403/404/422: o servidor recusou de um jeito que repetir não
 *    resolve — marca como 'failed', mantém guardado e visível na tela de
 *    sincronização; só some se alguém descartar de propósito.
 */

/** Abaixo do limite de 4,5MB de corpo das funções da Vercel, com folga pro multipart. */
export const MAX_DIRECT_BYTES = 3.5 * 1024 * 1024

export type RetryReason = 'network' | 'session' | 'too_large' | 'rate_limited' | 'server'
export type Classification =
  | { kind: 'synced' }
  | { kind: 'retry'; reason: RetryReason; status?: number; retryAfterMs?: number }
  | { kind: 'failed'; status: number; message: string }

export function classifyResponse(status: number, ok: boolean, retryAfterHeader?: string | null): Classification {
  if (ok) return { kind: 'synced' }
  if (status === 401) return { kind: 'retry', reason: 'session', status }
  if (status === 413) return { kind: 'retry', reason: 'too_large', status }
  if (status === 429) {
    const seconds = Number(retryAfterHeader)
    return { kind: 'retry', reason: 'rate_limited', status, retryAfterMs: Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined }
  }
  // 409 = a ordem ainda não tem o check-in no servidor (marco ainda na fila): repetir resolve, não é recusa definitiva.
  if (status === 408 || status === 409 || status === 425 || status >= 500) return { kind: 'retry', reason: 'server', status }
  return { kind: 'failed', status, message: `O servidor recusou o salvamento (código ${status}).` }
}

const BACKOFF_BASE_MS = 20_000
// App de campo: com sinal fraco é melhor tentar de novo logo do que esperar 15 min.
const BACKOFF_MAX_MS = 2 * 60_000
/** Nenhuma requisição da fila pode ficar pendurada pra sempre (travaria a fila inteira). */
const REQUEST_TIMEOUT_MS = 90_000
const DRAIN_WATCHDOG_MS = 5 * 60_000

export function backoffMs(attempts: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** Math.max(attempts, 0), BACKOFF_MAX_MS)
}

function itemBytes(item: PendingSave): number {
  let total = 0
  for (const files of Object.values(item.files)) for (const f of files) total += f.blob.size
  return total
}

async function sendRequest(item: PendingSave, formData: FormData): Promise<Classification> {
  try {
    const response = await fetch(`/api/units/${item.unitId}/appointments/${item.appointmentId}/service-order`, {
      method: 'PATCH',
      body: formData,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    return classifyResponse(response.status, response.ok, response.headers?.get?.('Retry-After') ?? null)
  } catch {
    return { kind: 'retry', reason: 'network' }
  }
}

function baseForm(item: PendingSave, saveId: string, includeFields: boolean): FormData {
  const formData = new FormData()
  if (includeFields) for (const [key, value] of Object.entries(item.fields)) formData.set(key, value)
  // Idempotência no servidor: o mesmo clientSaveId gera sempre o mesmo caminho de arquivo,
  // então reenviar depois de uma falha no meio nunca duplica foto nem assinatura.
  formData.set('clientSaveId', saveId)
  return formData
}

/** Marco de viagem/check-in/fim (fields.__event): vai para a rota de eventos, não para a de salvar a ordem. */
async function sendEvent(item: PendingSave): Promise<Classification> {
  try {
    const f = item.fields
    const response = await fetch(`/api/units/${item.unitId}/appointments/${item.appointmentId}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: f.__event,
        at: f.at,
        lat: f.lat != null ? Number(f.lat) : null,
        lng: f.lng != null ? Number(f.lng) : null,
        accuracy: f.accuracy != null ? Number(f.accuracy) : null,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    return classifyResponse(response.status, response.ok, response.headers?.get?.('Retry-After') ?? null)
  } catch {
    return { kind: 'retry', reason: 'network' }
  }
}

/** Andamento de um salvamento da fila (só números e etapas — nenhum nome de arquivo, URL ou dado da ordem). */
export type DrainProgress =
  | { itemId: string; phase: 'uploading'; done: number; total: number }
  | { itemId: string; phase: 'registering'; total: number }
  | { itemId: string; phase: 'finalizing' }
  /** Medição de uma etapa concluída (ms). */
  | { itemId: string; phase: 'timing'; stage: 'upload' | 'register' | 'final'; ms: number; count?: number; bytes?: number }

const progressListeners = new Set<(event: DrainProgress) => void>()
export function onDrainProgress(listener: (event: DrainProgress) => void): () => void {
  progressListeners.add(listener)
  return () => progressListeners.delete(listener)
}
function emit(event: DrainProgress) {
  for (const listener of progressListeners) {
    try {
      listener(event)
    } catch {
      // um ouvinte com defeito nunca atrapalha o envio
    }
  }
}

/** Quantos arquivos sobem ao mesmo tempo (celular em campo: mais que isso só disputa o mesmo sinal). */
export const UPLOAD_CONCURRENCY = 3

/** Executa `fn` sobre os itens com no máximo `limit` ao mesmo tempo, devolvendo os resultados NA ORDEM original. Depois da 1ª falha não começa novos. */
async function mapPool<T, R extends { ok: boolean }>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>, skipped: () => R): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  let failed = false
  async function worker() {
    while (next < items.length) {
      const index = next++
      if (failed) {
        results[index] = skipped()
        continue
      }
      const result = await fn(items[index]!, index)
      if (!result.ok) failed = true
      results[index] = result
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

async function trySyncOne(item: PendingSave): Promise<Classification> {
  if (item.fields.__event) return sendEvent(item)
  const alreadySliced = (item.sentFiles?.length ?? 0) > 0
  if (!alreadySliced && !directMediaUploadEnabled() && itemBytes(item) <= MAX_DIRECT_BYTES) {
    const formData = baseForm(item, item.id, true)
    for (const [fieldName, files] of Object.entries(item.files)) {
      for (const stored of files) formData.append(fieldName, new File([stored.blob], stored.name, { type: stored.type }))
    }
    const result = await sendRequest(item, formData)
    if (result.kind === 'retry' && result.reason === 'too_large') return trySlice(item)
    return result
  }
  return trySlice(item)
}

/** Fatiado: arquivos primeiro (em paralelo e registrados em lote, na ordem), depois os campos + assinatura. */
async function trySlice(item: PendingSave): Promise<Classification> {
  const sent = new Set(item.sentFiles ?? [])
  const direct = directMediaUploadEnabled()
  const pendingMedia: { fieldName: string; position: number; stored: PendingSave['files'][string][number]; key: string }[] = []
  for (const [fieldName, files] of Object.entries(item.files)) {
    if (fieldName === 'signature') continue
    for (const [position, stored] of files.entries()) {
      const key = `${fieldName}:${position}`
      if (sent.has(key)) continue
      if (direct && isMediaField(fieldName)) {
        pendingMedia.push({ fieldName, position, stored, key })
        continue
      }
      // fluxo antigo (upload direto desligado): uma foto por requisição
      const formData = baseForm(item, `${item.id}-${fieldName}-${position}`, false)
      formData.append(fieldName, new File([stored.blob], stored.name, { type: stored.type }))
      const result = await sendRequest(item, formData)
      if (result.kind !== 'synced') return result
      sent.add(key)
      await updatePendingSave(item.id, { sentFiles: [...sent] })
    }
  }

  if (pendingMedia.length > 0) {
    const total = pendingMedia.length
    const bytes = pendingMedia.reduce((sum, entry) => sum + entry.stored.blob.size, 0)
    let done = 0
    emit({ itemId: item.id, phase: 'uploading', done, total })
    const uploadStart = Date.now()
    type UploadResult = { ok: true; media: UploadedMedia } | { ok: false; result: Classification }
    const results = await mapPool<(typeof pendingMedia)[number], UploadResult>(
      pendingMedia,
      UPLOAD_CONCURRENCY,
      async (entry) => {
        const uploaded = await uploadMediaFile({
          unitId: item.unitId,
          appointmentId: item.appointmentId,
          fieldName: entry.fieldName,
          saveId: `${item.id}-${entry.fieldName}-${entry.position}`,
          position: entry.position,
          file: new File([entry.stored.blob], entry.stored.name, { type: entry.stored.type }),
        })
        if (uploaded.ok) emit({ itemId: item.id, phase: 'uploading', done: ++done, total })
        return uploaded
      },
      () => ({ ok: false, result: { kind: 'retry', reason: 'network' } }),
    )
    emit({ itemId: item.id, phase: 'timing', stage: 'upload', ms: Date.now() - uploadStart, count: total, bytes })

    // Registra só o trecho contínuo que subiu (mantém a ordem das fotos); o resto sobe de novo na próxima tentativa (envio idempotente).
    const registered: typeof pendingMedia = []
    let firstFailure: Classification | null = null
    for (const [index, result] of results.entries()) {
      if (result.ok) registered.push(pendingMedia[index]!)
      else {
        // A 1ª falha em ordem de índice é sempre a verdadeira: só são "puladas" as tarefas que começam DEPOIS de uma falha (índices maiores).
        firstFailure = result.result
        break
      }
    }
    if (registered.length > 0) {
      emit({ itemId: item.id, phase: 'registering', total: registered.length })
      const registerStart = Date.now()
      const registration = await registerMediaBatch(
        item.unitId,
        item.appointmentId,
        registered.map((entry) => (results[pendingMedia.indexOf(entry)] as { ok: true; media: UploadedMedia }).media),
      )
      emit({ itemId: item.id, phase: 'timing', stage: 'register', ms: Date.now() - registerStart, count: registered.length })
      if (registration.kind !== 'synced') return registration
      for (const entry of registered) sent.add(entry.key)
      await updatePendingSave(item.id, { sentFiles: [...sent] })
    }
    if (firstFailure) return firstFailure
  }

  const hasFinalStep = Object.keys(item.fields).length > 0 || (item.files.signature?.length ?? 0) > 0
  if (!hasFinalStep) return { kind: 'synced' }
  const finalForm = baseForm(item, `${item.id}-final`, true)
  for (const stored of item.files.signature ?? []) finalForm.append('signature', new File([stored.blob], stored.name, { type: stored.type }))
  emit({ itemId: item.id, phase: 'finalizing' })
  const finalStart = Date.now()
  const finalResult = await sendRequest(item, finalForm)
  emit({ itemId: item.id, phase: 'timing', stage: 'final', ms: Date.now() - finalStart })
  return finalResult
}

export type DrainResult = { synced: number; failed: number; remaining: number }
/** 'default' = tudo menos vídeo (Sign Off, fotos, marcos); 'video' = vídeos grandes, numa pista própria para não segurar o Sign Off; 'all' = as duas. */
export type DrainLane = 'default' | 'video' | 'all'
export type DrainOptions = {
  /** 'Tentar agora' manual: ignora o backoff e também retenta os itens 'failed'. */
  force?: boolean
  /** Rede voltou / app voltou ao primeiro plano: ignora a espera do backoff, mas NÃO retenta itens 'failed'. */
  ignoreBackoff?: boolean
  /** Padrão 'all'. O salvar do Sign Off usa 'default' para NÃO esperar um vídeo grande que está subindo. */
  lane?: DrainLane
}

const isVideoItem = (item: PendingSave) => (item.files?.videos?.length ?? 0) > 0

async function drainOnce(options: DrainOptions, lane: 'default' | 'video'): Promise<DrainResult> {
  const items = (await listPendingSaves()).filter((item) => isVideoItem(item) === (lane === 'video'))
  const now = Date.now()
  let synced = 0
  let failed = 0

  const owner = getActiveOwner()
  for (const item of items) {
    // Troca de usuário no mesmo aparelho: item de outro funcionário não é enviado por esta sessão
    // (o servidor recusaria) — fica guardado, visível, até a conta original voltar.
    if (owner && item.ownerId && item.ownerId !== owner) continue
    if (!options.force) {
      if (item.status === 'failed') continue
      if (!options.ignoreBackoff && item.nextAttemptAt && item.nextAttemptAt > now) continue
    }

    const result = await trySyncOne(item)
    if (result.kind === 'synced') {
      await deletePendingSave(item.id)
      synced += 1
      void setMeta('last_sync_at', Date.now())
      continue
    }

    const attempts = (item.attempts ?? 0) + 1
    if (result.kind === 'failed') {
      await updatePendingSave(item.id, { status: 'failed', attempts, lastError: result.message, lastHttpStatus: result.status })
      failed += 1
    } else {
      await updatePendingSave(item.id, {
        status: 'pending',
        attempts,
        nextAttemptAt: Date.now() + (result.retryAfterMs ?? backoffMs(attempts)),
        lastError: result.reason,
        lastHttpStatus: result.status,
      })
    }
  }

  const remaining = await listPendingSaves()
  return { synced, failed, remaining: remaining.length }
}

const laneState: Record<'default' | 'video', { inFlight: Promise<DrainResult> | null; since: number }> = {
  default: { inFlight: null, since: 0 },
  video: { inFlight: null, since: 0 },
}
/** Nome do Web Lock de cada pista ('default' mantém o nome antigo, compatível com abas abertas antes desta versão). */
const LOCK_NAME: Record<'default' | 'video', string> = { default: 'alizo-offline-drain', video: 'alizo-offline-drain-video' }

function drainLane(options: DrainOptions, lane: 'default' | 'video'): Promise<DrainResult> {
  const state = laneState[lane]
  // Vigia: se uma sincronização antiga ficou pendurada (rede morta no meio do envio), abandona e começa outra.
  const stale = state.inFlight !== null && Date.now() - state.since >= DRAIN_WATCHDOG_MS
  if (state.inFlight && !stale) return state.inFlight

  const run = async (): Promise<DrainResult> => {
    // Abandonando uma execução travada, o Web Lock dela continuaria preso pra sempre: `steal` o toma de volta
    // (a antiga é considerada morta; envios são idempotentes, então o pior caso é reenviar o mesmo arquivo).
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
    if (!locks?.request) return drainOnce(options, lane)
    let result: DrainResult | null
    try {
      result = await locks.request(LOCK_NAME[lane], stale ? { steal: true } : { ifAvailable: true }, async (lock) => {
        if (!lock) return null
        return drainOnce(options, lane)
      })
    } catch (error) {
      // Quando OUTRA execução toma o lock (`steal`), o navegador rejeita a promessa desta com AbortError. Isso é o fluxo normal
      // de "abandonei a execução travada": não é erro para ninguém — quem esperava por esta recebe o resultado da execução nova.
      if ((error as { name?: string } | null)?.name === 'AbortError' && state.inFlight && state.inFlight !== current) return state.inFlight
      throw error
    }
    if (result) return result
    return { synced: 0, failed: 0, remaining: (await listPendingSaves()).length }
  }

  state.since = Date.now()
  const current: Promise<DrainResult> = run().finally(() => {
    if (state.inFlight === current) state.inFlight = null
  })
  state.inFlight = current
  return current
}

/**
 * Percorre a fila. Uma única execução por pista por vez: dentro da mesma aba (promessa compartilhada) e entre abas (Web Locks, quando o
 * navegador suporta) — antes, dois drains simultâneos podiam reenviar o mesmo item e duplicar arquivos.
 *
 * Duas pistas independentes (vídeo × resto): o Sign Off (fotos + assinatura) não fica preso atrás de um vídeo grande. É seguro porque o
 * salvamento final não reescreve a lista de fotos (ver finalize.ts) e o registro de mídia é atômico no banco.
 */
export async function drainPendingSaves(options: DrainOptions = {}): Promise<DrainResult> {
  const lane = options.lane ?? 'all'
  if (lane === 'default' || lane === 'video') return drainLane(options, lane)
  const [a, b] = await Promise.all([drainLane(options, 'default'), drainLane(options, 'video')])
  // a pista que terminou por último tem o retrato mais atual da fila
  return { synced: a.synced + b.synced, failed: a.failed + b.failed, remaining: Math.min(a.remaining, b.remaining) }
}
