import { createClient } from '@/lib/supabase/client'
import { buildMediaPath, MEDIA_FIELD_KIND, type MediaKind } from '@/lib/service-orders/media'
import { classifyResponse, type Classification } from './offline-sync'

/**
 * Upload direto aparelho → Storage (sem passar pelo corpo limitado da
 * Vercel, ~4,5MB) + registro verificado na ordem. Ligado por padrão (ver directMediaUploadEnabled). Caminho determinístico + upsert =
 * reenviar nunca duplica.
 */
const OVERRIDE_KEY = 'alizo_direct_media'

/** Ajuste por aparelho: '1' força ligado, '0' força desligado, null = segue o padrão. */
function readOverride(): '1' | '0' | null {
  try {
    if (typeof localStorage === 'undefined') return null
    const value = localStorage.getItem(OVERRIDE_KEY)
    return value === '1' || value === '0' ? value : null
  } catch {
    return null
  }
}

/** on=true força ligado neste aparelho, on=false força desligado (volta ao fluxo antigo), null remove o ajuste. */
export function setDirectMediaOverride(on: boolean | null): void {
  try {
    if (on === null) localStorage.removeItem(OVERRIDE_KEY)
    else localStorage.setItem(OVERRIDE_KEY, on ? '1' : '0')
  } catch {
    // sem localStorage (modo privado): segue o padrão
  }
}

export function directMediaOverrideActive(): boolean {
  return readOverride() === '1'
}

export function directMediaOverrideOff(): boolean {
  return readOverride() === '0'
}

/**
 * PADRÃO LIGADO (ativado em produção em 2026-10-17, autorização do Vinicius).
 * Rollback imediato, sem mexer em código: definir NEXT_PUBLIC_DIRECT_MEDIA_UPLOAD=false
 * na Vercel e redeployar (ou promover o deployment anterior). Por aparelho: ?upload_direto=0
 * na tela de Sincronização volta aquele aparelho ao fluxo antigo (que segue no código como fallback).
 */
export function directMediaUploadEnabled(): boolean {
  const override = readOverride()
  if (override === '1') return true
  if (override === '0') return false
  return process.env.NEXT_PUBLIC_DIRECT_MEDIA_UPLOAD !== 'false'
}

export function isMediaField(fieldName: string): boolean {
  return fieldName in MEDIA_FIELD_KIND
}

type UploadParams = {
  unitId: string
  appointmentId: string
  fieldName: string
  saveId: string
  position: number
  file: File
}

/** Tempo máximo do envio de um arquivo: mínimo 60s, ou o suficiente pra ~40KB/s (sinal ruim de campo). */
export function uploadTimeoutMs(bytes: number): number {
  return Math.max(60_000, Math.ceil(bytes / 40_000) * 1000)
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

const authLike = (message: string, status?: number) => status === 401 || status === 403 || /jwt|token|unauthor|expired/i.test(message)

export type UploadedMedia = { path: string; kind: MediaKind }

/** Só o envio ao Storage (caminho determinístico + upsert: reenviar nunca duplica). O registro na ordem é feito depois, em lote e na ordem original. */
export async function uploadMediaFile(params: UploadParams): Promise<{ ok: true; media: UploadedMedia } | { ok: false; result: Classification }> {
  const kind = MEDIA_FIELD_KIND[params.fieldName]
  if (!kind) return { ok: false, result: { kind: 'failed', status: 400, message: 'Tipo de mídia desconhecido.' } }
  const path = buildMediaPath({
    unitId: params.unitId,
    appointmentId: params.appointmentId,
    kind,
    saveId: params.saveId,
    position: params.position,
    fileName: params.file.name,
  })

  try {
    const { error } = await withTimeout(
      createClient()
        .storage.from('service-orders')
        .upload(path, params.file, { contentType: params.file.type || undefined, upsert: true }),
      uploadTimeoutMs(params.file.size),
    )
    if (error) {
      const status = Number((error as { statusCode?: string | number }).statusCode) || undefined
      if (authLike(error.message ?? '', status)) return { ok: false, result: { kind: 'retry', reason: 'session', status: 401 } }
      if (status === 413) return { ok: false, result: { kind: 'failed', status: 413, message: 'Arquivo grande demais para o servidor.' } }
      return { ok: false, result: { kind: 'retry', reason: 'server', status } }
    }
  } catch {
    return { ok: false, result: { kind: 'retry', reason: 'network' } }
  }
  return { ok: true, media: { path, kind } }
}

/** Registra na ordem (uma chamada) arquivos que JÁ estão no Storage. O servidor confere cada um no bucket antes de registrar; a mesma ordem da lista é mantida. */
export async function registerMediaBatch(unitId: string, appointmentId: string, items: UploadedMedia[]): Promise<Classification> {
  if (items.length === 0) return { kind: 'synced' }
  try {
    const response = await fetch(`/api/units/${unitId}/appointments/${appointmentId}/service-order/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: items.map((item) => ({ path: item.path, kind: item.kind })) }),
      signal: AbortSignal.timeout(60_000),
    })
    // 422 = arquivo ainda não visível no bucket: repetir resolve.
    if (response.status === 422) return { kind: 'retry', reason: 'server', status: 422 }
    return classifyResponse(response.status, response.ok, response.headers?.get?.('Retry-After') ?? null)
  } catch {
    return { kind: 'retry', reason: 'network' }
  }
}

/** Um arquivo: envia e registra (usado pelo envio de vídeo avulso e por quem não precisa de lote). */
export async function uploadAndRegisterMedia(params: UploadParams): Promise<Classification> {
  const uploaded = await uploadMediaFile(params)
  if (!uploaded.ok) return uploaded.result
  return registerMediaBatch(params.unitId, params.appointmentId, [uploaded.media])
}
