/**
 * Mídia da ordem de serviço (fotos e vídeos) — regras compartilhadas entre
 * o cliente (upload direto ao Storage) e a rota que registra o arquivo na
 * ordem (service-order/media/route.ts). Puro, sem I/O.
 */

export const MEDIA_KINDS = ['before', 'after', 'material_invoice', 'video'] as const
export type MediaKind = (typeof MEDIA_KINDS)[number]

/** Campo do FormData/fila → tipo de mídia. */
export const MEDIA_FIELD_KIND: Record<string, MediaKind> = {
  photosBefore: 'before',
  photosAfter: 'after',
  materialPhotos: 'material_invoice',
  videos: 'video',
}

const KIND_PREFIX: Record<MediaKind, string> = {
  before: 'antes',
  after: 'depois',
  material_invoice: 'nota-fiscal',
  video: 'video',
}

/** Vídeo de campo: no máximo 15s, comprimido no aparelho pra ficar bem abaixo do limite de 50MB do Supabase (plano com limite de gastos ligado). */
export const MAX_VIDEO_SECONDS = 15
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024
export const MAX_PHOTO_BYTES = 25 * 1024 * 1024

export function isMediaKind(value: unknown): value is MediaKind {
  return typeof value === 'string' && (MEDIA_KINDS as readonly string[]).includes(value)
}

export function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9.\-_]/g, '_').slice(-80) || 'arquivo'
}

/** Caminho determinístico: mesmo saveId + posição + nome = mesmo caminho, então reenviar (upsert) nunca duplica o arquivo. */
export function buildMediaPath(params: {
  unitId: string
  appointmentId: string
  kind: MediaKind
  saveId: string
  position: number
  fileName: string
}): string {
  const saveId = params.saveId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80) || 'sem-id'
  return `${params.unitId}/${params.appointmentId}/${KIND_PREFIX[params.kind]}-${saveId}-${params.position}-${safeFileName(params.fileName)}`
}

export type MediaRegistrationItem = { path: string; kind: MediaKind }

/** Valida o que o cliente pede pra registrar: só caminhos DESTA ordem, sem '..', com tipo conhecido. */
export function validateMediaItems(
  items: unknown,
  unitId: string,
  appointmentId: string,
): { ok: true; items: MediaRegistrationItem[] } | { ok: false; error: string } {
  if (!Array.isArray(items) || items.length === 0) return { ok: false, error: 'Nenhum arquivo para registrar.' }
  if (items.length > 40) return { ok: false, error: 'Arquivos demais de uma vez.' }
  const prefix = `${unitId}/${appointmentId}/`
  const valid: MediaRegistrationItem[] = []
  for (const raw of items) {
    const item = raw as { path?: unknown; kind?: unknown }
    if (typeof item?.path !== 'string' || !isMediaKind(item.kind)) return { ok: false, error: 'Item de mídia inválido.' }
    if (!item.path.startsWith(prefix) || item.path.includes('..')) return { ok: false, error: 'Caminho de mídia não pertence a esta ordem.' }
    valid.push({ path: item.path, kind: item.kind })
  }
  return { ok: true, items: valid }
}

/** Limite de tamanho por tipo, conferido no servidor depois do upload (o Storage só conhece o limite global). */
export function mediaSizeLimit(kind: MediaKind): number {
  return kind === 'video' ? MAX_VIDEO_BYTES : MAX_PHOTO_BYTES
}

export function isAllowedContentType(kind: MediaKind, contentType: string | null | undefined): boolean {
  const type = (contentType ?? '').toLowerCase()
  if (kind === 'video') return type.startsWith('video/')
  return type.startsWith('image/')
}

/** Quantos vídeos de até 15s cabem numa ordem de uma vez (pedido do Vinicius: pelo menos 4). */
export const MAX_VIDEO_CLIPS = 10

/** A URL pública pertence mesmo a esta ordem? (impede excluir mídia de outra ordem/unidade pela rota) */
export function isMediaUrlOfAppointment(url: unknown, unitId: string, appointmentId: string): url is string {
  return (
    typeof url === 'string' &&
    !url.includes('..') &&
    url.includes(`/storage/v1/object/public/service-orders/${unitId}/${appointmentId}/`)
  )
}
