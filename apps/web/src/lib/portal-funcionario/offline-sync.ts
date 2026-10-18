import { directMediaUploadEnabled, isMediaField, uploadAndRegisterMedia } from './media-upload'
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

/** Fatiado: uma foto por requisição (salvamento só de foto), depois os campos + assinatura. */
async function trySlice(item: PendingSave): Promise<Classification> {
  const sent = new Set(item.sentFiles ?? [])
  for (const [fieldName, files] of Object.entries(item.files)) {
    if (fieldName === 'signature') continue
    for (const [position, stored] of files.entries()) {
      const key = `${fieldName}:${position}`
      if (sent.has(key)) continue
      let result: Classification
      if (directMediaUploadEnabled() && isMediaField(fieldName)) {
        result = await uploadAndRegisterMedia({
          unitId: item.unitId,
          appointmentId: item.appointmentId,
          fieldName,
          saveId: `${item.id}-${fieldName}-${position}`,
          position,
          file: new File([stored.blob], stored.name, { type: stored.type }),
        })
      } else {
        const formData = baseForm(item, `${item.id}-${fieldName}-${position}`, false)
        formData.append(fieldName, new File([stored.blob], stored.name, { type: stored.type }))
        result = await sendRequest(item, formData)
      }
      if (result.kind !== 'synced') return result
      sent.add(key)
      await updatePendingSave(item.id, { sentFiles: [...sent] })
    }
  }

  const hasFinalStep = Object.keys(item.fields).length > 0 || (item.files.signature?.length ?? 0) > 0
  if (!hasFinalStep) return { kind: 'synced' }
  const finalForm = baseForm(item, `${item.id}-final`, true)
  for (const stored of item.files.signature ?? []) finalForm.append('signature', new File([stored.blob], stored.name, { type: stored.type }))
  return sendRequest(item, finalForm)
}

export type DrainResult = { synced: number; failed: number; remaining: number }
export type DrainOptions = {
  /** 'Tentar agora' manual: ignora o backoff e também retenta os itens 'failed'. */
  force?: boolean
  /** Rede voltou / app voltou ao primeiro plano: ignora a espera do backoff, mas NÃO retenta itens 'failed'. */
  ignoreBackoff?: boolean
}

async function drainOnce(options: DrainOptions): Promise<DrainResult> {
  const items = await listPendingSaves()
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

let inFlight: Promise<DrainResult> | null = null
let inFlightSince = 0

/**
 * Percorre a fila inteira. Uma única execução por vez: dentro da mesma
 * aba (promessa compartilhada) e entre abas (Web Locks, quando o
 * navegador suporta) — antes, dois drains simultâneos podiam reenviar o
 * mesmo item e duplicar arquivos.
 */
export function drainPendingSaves(options: DrainOptions = {}): Promise<DrainResult> {
  // Vigia: se uma sincronização antiga ficou pendurada (rede morta no meio do envio), abandona e começa outra.
  const stale = inFlight !== null && Date.now() - inFlightSince >= DRAIN_WATCHDOG_MS
  if (inFlight && !stale) return inFlight

  const run = async (): Promise<DrainResult> => {
    // Abandonando uma execução travada, o Web Lock dela continuaria preso pra sempre: `steal` o toma de volta
    // (a antiga é considerada morta; envios são idempotentes, então o pior caso é reenviar o mesmo arquivo).
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
    if (!locks?.request) return drainOnce(options)
    let result: DrainResult | null
    try {
      result = await locks.request('alizo-offline-drain', stale ? { steal: true } : { ifAvailable: true }, async (lock) => {
        if (!lock) return null
        return drainOnce(options)
      })
    } catch (error) {
      // Quando OUTRA execução toma o lock (`steal`), o navegador rejeita a promessa desta com AbortError. Isso é o fluxo normal
      // de "abandonei a execução travada": não é erro para ninguém — quem esperava por esta recebe o resultado da execução nova.
      if ((error as { name?: string } | null)?.name === 'AbortError' && inFlight && inFlight !== current) return inFlight
      throw error
    }
    if (result) return result
    return { synced: 0, failed: 0, remaining: (await listPendingSaves()).length }
  }

  inFlightSince = Date.now()
  const current: Promise<DrainResult> = run().finally(() => {
    if (inFlight === current) inFlight = null
  })
  inFlight = current
  return current
}
