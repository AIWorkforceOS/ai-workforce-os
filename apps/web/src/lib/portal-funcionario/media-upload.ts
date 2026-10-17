import { createClient } from '@/lib/supabase/client'
import { buildMediaPath, MEDIA_FIELD_KIND } from '@/lib/service-orders/media'
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

const authLike = (message: string, status?: number) => status === 401 || status === 403 || /jwt|token|unauthor|expired/i.test(message)

export async function uploadAndRegisterMedia(params: UploadParams): Promise<Classification> {
  const kind = MEDIA_FIELD_KIND[params.fieldName]
  if (!kind) return { kind: 'failed', status: 400, message: 'Tipo de mídia desconhecido.' }
  const path = buildMediaPath({
    unitId: params.unitId,
    appointmentId: params.appointmentId,
    kind,
    saveId: params.saveId,
    position: params.position,
    fileName: params.file.name,
  })

  try {
    const { error } = await createClient()
      .storage.from('service-orders')
      .upload(path, params.file, { contentType: params.file.type || undefined, upsert: true })
    if (error) {
      const status = Number((error as { statusCode?: string | number }).statusCode) || undefined
      if (authLike(error.message ?? '', status)) return { kind: 'retry', reason: 'session', status: 401 }
      if (status === 413) return { kind: 'failed', status: 413, message: 'Arquivo grande demais para o servidor.' }
      return { kind: 'retry', reason: 'server', status }
    }
  } catch {
    return { kind: 'retry', reason: 'network' }
  }

  try {
    const response = await fetch(`/api/units/${params.unitId}/appointments/${params.appointmentId}/service-order/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ path, kind }] }),
    })
    // 422 = arquivo ainda não visível no bucket: repetir resolve.
    if (response.status === 422) return { kind: 'retry', reason: 'server', status: 422 }
    return classifyResponse(response.status, response.ok, response.headers?.get?.('Retry-After') ?? null)
  } catch {
    return { kind: 'retry', reason: 'network' }
  }
}
