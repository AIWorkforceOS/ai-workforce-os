import type { Unit } from '@/lib/types'

const GRAPH_VERSION = 'v25.0'
const GRAPH_URL = `https://graph.facebook.com/${GRAPH_VERSION}`
const REQUEST_TIMEOUT_MS = 20_000

export type MetaWhatsappConfig = {
  accessToken: string
  phoneNumberId: string
  wabaId: string | null
}

export class MetaWhatsappError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'MetaWhatsappError'
  }
}

export function getMetaWhatsappConfig(unit: Unit): MetaWhatsappConfig | null {
  if (unit.whatsapp_connection_mode !== 'official') return null
  const accessToken = process.env.META_WHATSAPP_ACCESS_TOKEN?.trim()
  const phoneNumberId = unit.meta_whatsapp_phone_number_id?.trim()
  if (!accessToken || !phoneNumberId) return null
  return {
    accessToken,
    phoneNumberId,
    wabaId: unit.meta_whatsapp_waba_id?.trim() || null,
  }
}

async function graphRequest(config: MetaWhatsappConfig, path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(`${GRAPH_URL}/${path.replace(/^\/+/, '')}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new MetaWhatsappError(
      body?.error?.message ?? `Meta WhatsApp retornou status ${response.status}`,
      response.status,
    )
  }
  return response
}

export async function sendMetaWhatsappText(config: MetaWhatsappConfig, phone: string, text: string): Promise<void> {
  await graphRequest(config, `${config.phoneNumberId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: phone.replace(/\D/g, ''),
      type: 'text',
      text: { preview_url: false, body: text },
    }),
  })
}

async function uploadMedia(
  config: MetaWhatsappConfig,
  bytes: Uint8Array,
  mimeType: string,
  fileName: string,
): Promise<string> {
  const form = new FormData()
  form.append('messaging_product', 'whatsapp')
  form.append('type', mimeType)
  const copied = Uint8Array.from(bytes)
  form.append('file', new Blob([copied.buffer as ArrayBuffer], { type: mimeType }), fileName)
  const response = await graphRequest(config, `${config.phoneNumberId}/media`, { method: 'POST', body: form })
  const body = (await response.json()) as { id?: string }
  if (!body.id) throw new Error('A Meta não devolveu o identificador da mídia enviada.')
  return body.id
}

export async function sendMetaWhatsappAudio(
  config: MetaWhatsappConfig,
  phone: string,
  base64Audio: string,
  mimeType = 'audio/ogg',
): Promise<void> {
  const mediaId = await uploadMedia(config, Buffer.from(base64Audio, 'base64'), mimeType, 'resposta.ogg')
  await graphRequest(config, `${config.phoneNumberId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: phone.replace(/\D/g, ''),
      type: 'audio',
      audio: { id: mediaId },
    }),
  })
}

export async function sendMetaWhatsappDocument(
  config: MetaWhatsappConfig,
  phone: string,
  link: string,
  fileName: string,
  caption: string,
): Promise<void> {
  await graphRequest(config, `${config.phoneNumberId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: phone.replace(/\D/g, ''),
      type: 'document',
      document: { link, filename: fileName, caption },
    }),
  })
}

export async function downloadMetaWhatsappMedia(
  config: MetaWhatsappConfig,
  mediaId: string,
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const metadataResponse = await graphRequest(config, mediaId)
  const metadata = (await metadataResponse.json()) as { url?: string; mime_type?: string }
  if (!metadata.url) throw new Error('A Meta não devolveu a URL da mídia recebida.')

  const mediaResponse = await fetch(metadata.url, {
    headers: { Authorization: `Bearer ${config.accessToken}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!mediaResponse.ok) throw new MetaWhatsappError('Falha ao baixar mídia recebida da Meta.', mediaResponse.status)
  return {
    bytes: new Uint8Array(await mediaResponse.arrayBuffer()),
    mimeType: metadata.mime_type || mediaResponse.headers.get('content-type') || 'application/octet-stream',
  }
}
