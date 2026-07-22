import { logOpenAIUsage } from '@/lib/api-usage'

export function getOpenAIApiKey(): string | null {
  return process.env.OPENAI_API_KEY || null
}

export type ChatMessage = { role: 'user' | 'assistant'; content: string }

export async function generateChatReply(params: {
  apiKey: string
  systemPrompt: string
  history: ChatMessage[]
  model?: string
}): Promise<string> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify({
      model: params.model ?? 'gpt-4o-mini',
      messages: [{ role: 'system', content: params.systemPrompt }, ...params.history],
      temperature: 0.7,
      max_tokens: 400,
    }),
  })

  const data = await response.json()

  if (!response.ok) {
    throw new Error(data?.error?.message ?? `OpenAI retornou status ${response.status}`)
  }

  await logOpenAIUsage({ endpoint: 'chat.completions', model: params.model ?? 'gpt-4o-mini', usage: data.usage })

  return (data.choices?.[0]?.message?.content ?? '').trim()
}

/**
 * Chamada em JSON mode: o modelo é obrigado a responder um objeto JSON
 * válido. Usada pelos extractors/avaliadores do Recruiter. Retorna o
 * objeto já parseado; lança se a resposta não for JSON válido.
 */
export async function generateStructuredReply<T = Record<string, unknown>>(params: {
  apiKey: string
  systemPrompt: string
  history: ChatMessage[]
  model?: string
  maxTokens?: number
}): Promise<T> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify({
      model: params.model ?? 'gpt-4o-mini',
      messages: [{ role: 'system', content: params.systemPrompt }, ...params.history],
      temperature: 0.2,
      max_tokens: params.maxTokens ?? 1500,
      response_format: { type: 'json_object' },
    }),
  })

  const data = await response.json()

  if (!response.ok) {
    throw new Error(data?.error?.message ?? `OpenAI retornou status ${response.status}`)
  }

  await logOpenAIUsage({ endpoint: 'chat.completions', model: params.model ?? 'gpt-4o-mini', usage: data.usage })

  const content = (data.choices?.[0]?.message?.content ?? '').trim()
  return JSON.parse(content) as T
}

/**
 * Transcreve um áudio (ex.: nota de voz do WhatsApp) para texto via Whisper.
 * Recebe o arquivo em base64 (formato em que a Evolution API devolve mídia
 * descriptografada) e devolve o texto já pronto para entrar no motor de
 * conversa como se o cliente tivesse digitado. `durationSeconds` vem do
 * próprio Whisper (verbose_json) e alimenta o registro de custo/uso.
 */
export async function transcribeAudio(params: {
  apiKey: string
  base64Audio: string
  mimeType: string
}): Promise<{ text: string; durationSeconds: number }> {
  const audioBuffer = Buffer.from(params.base64Audio, 'base64')
  const extension = params.mimeType.includes('ogg') ? 'ogg' : params.mimeType.split('/')[1]?.split(';')[0] || 'ogg'

  const formData = new FormData()
  formData.append('file', new Blob([audioBuffer], { type: params.mimeType }), `audio.${extension}`)
  formData.append('model', 'whisper-1')
  formData.append('response_format', 'verbose_json')

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${params.apiKey}` },
    body: formData,
  })

  const data = await response.json()

  if (!response.ok) {
    throw new Error(data?.error?.message ?? `OpenAI retornou status ${response.status}`)
  }

  return { text: (data.text ?? '').trim(), durationSeconds: Number(data.duration ?? 0) }
}

/**
 * Gera embeddings (text-embedding-3-small, 1536 dims — par com o
 * vector(1536) de candidates.profile_embedding). Aceita lote.
 */
export async function embedTexts(apiKey: string, texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return []

  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: texts,
    }),
  })

  const data = await response.json()

  if (!response.ok) {
    throw new Error(data?.error?.message ?? `OpenAI retornou status ${response.status}`)
  }

  await logOpenAIUsage({ endpoint: 'embeddings', model: 'text-embedding-3-small', usage: data.usage })

  const rows = (data.data ?? []) as { index: number; embedding: number[] }[]
  return rows.sort((a, b) => a.index - b.index).map((row) => row.embedding)
}
