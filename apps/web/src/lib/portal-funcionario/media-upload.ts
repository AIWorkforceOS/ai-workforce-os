import { createClient } from '@/lib/supabase/client'
import { buildMediaPath, MEDIA_FIELD_KIND } from '@/lib/service-orders/media'
import { classifyResponse, type Classification } from './offline-sync'

/**
 * Upload direto aparelho → Storage (sem passar pelo corpo limitado da
 * Vercel, ~4,5MB) + registro verificado na ordem. Desligado por padrão:
 * só vale com NEXT_PUBLIC_DIRECT_MEDIA_UPLOAD=true, pra validar antes de
 * mexer no fluxo de produção do Mawi. Caminho determinístico + upsert =
 * reenviar nunca duplica.
 */
export function directMediaUploadEnabled(): boolean {
  return process.env.NEXT_PUBLIC_DIRECT_MEDIA_UPLOAD === 'true'
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
