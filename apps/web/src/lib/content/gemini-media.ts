import { GEMINI_IMAGE_COST_USD, GEMINI_VIDEO_15S_COST_USD, reserveGeminiUsage } from '@/lib/api-usage'

const INTERACTIONS_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions'
const MEDIA_TIMEOUT_MS = 180_000

type InteractionPart = { type?: string; data?: string; mime_type?: string }
type InteractionStep = { type?: string; content?: InteractionPart[] }
type InteractionResponse = { steps?: InteractionStep[]; status?: string; error?: { message?: string } }

function mediaFrom(data: InteractionResponse, type: 'image' | 'video'): { data: string; mimeType: string } {
  for (const step of data.steps ?? []) {
    for (const part of step.content ?? []) {
      if (part.type === type && part.data) return { data: part.data, mimeType: part.mime_type || (type === 'video' ? 'video/mp4' : 'image/png') }
    }
  }
  throw new Error(`O Gemini concluiu a geração sem devolver ${type === 'video' ? 'o vídeo' : 'a imagem'}.`)
}
async function interaction(params: { apiKey: string; body: Record<string, unknown> }): Promise<InteractionResponse> {
  const response = await fetch(INTERACTIONS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': params.apiKey, 'Api-Revision': '2026-05-20' },
    body: JSON.stringify({ ...params.body, store: false }),
    signal: AbortSignal.timeout(MEDIA_TIMEOUT_MS),
  })
  const data = (await response.json().catch(() => ({}))) as InteractionResponse
  if (!response.ok) throw new Error(data.error?.message ?? `Gemini retornou status ${response.status}.`)
  return data
}

export function getGeminiApiKey(): string | null {
  return process.env.GEMINI_API_KEY || null
}

export async function generateGeminiImage(params: { apiKey: string; prompt: string }): Promise<{ base64: string; mimeType: string }> {
  const reserved = await reserveGeminiUsage({
    endpoint: 'images.generate',
    model: 'gemini-nano-banana-2.1',
    estimatedCostUsd: GEMINI_IMAGE_COST_USD,
    metadata: { resolution: '2K', aspect_ratio: '4:5' },
  })
  if (!reserved) throw new Error('O limite mensal de US$ 20 do Gemini foi atingido ou não pôde ser validado. Nenhuma geração paga foi iniciada.')
  const data = await interaction({
    apiKey: params.apiKey,
    body: {
      model: 'gemini-nano-banana-2.1',
      input: [{ type: 'text', text: params.prompt }],
      response_format: { type: 'image', aspect_ratio: '4:5', resolution: '2K' },
    },
  })
  const media = mediaFrom(data, 'image')
  return { base64: media.data, mimeType: media.mimeType }
}

export async function generateGeminiVideo(params: { apiKey: string; prompt: string }): Promise<{ bytes: Buffer; mimeType: string; duration: number }> {
  const reserved = await reserveGeminiUsage({
    endpoint: 'videos.generate',
    model: 'gemini-omni-1.2-flash',
    estimatedCostUsd: GEMINI_VIDEO_15S_COST_USD,
    metadata: { resolution: '720p', aspect_ratio: '9:16', duration_seconds: 15 },
  })
  if (!reserved) throw new Error('O limite mensal de US$ 20 do Gemini foi atingido ou não pôde ser validado. Nenhuma geração paga foi iniciada.')
  const data = await interaction({
    apiKey: params.apiKey,
    body: {
      model: 'gemini-omni-1.2-flash',
      input: [{ type: 'text', text: params.prompt }],
      response_format: { type: 'video', aspect_ratio: '9:16', resolution: '720p', duration: '15s' },
    },
  })
  const media = mediaFrom(data, 'video')
  return { bytes: Buffer.from(media.data, 'base64'), mimeType: media.mimeType, duration: 15 }
}
