import { logOpenAIImageUsage, logOpenAIUsage } from '@/lib/api-usage'

export function getOpenAIApiKey(): string | null {
  return process.env.OPENAI_API_KEY || null
}

// Fase 14 (observabilidade, briefing): "nenhuma requisição deve ficar presa
// indefinidamente" — nenhuma das chamadas à OpenAI neste arquivo tinha
// timeout antes disso; uma resposta travada do provedor prendia a
// requisição (webhook do WhatsApp, cron, rota de API) sem limite. Todo
// fetch() abaixo usa AbortSignal.timeout, que já lança um erro claro
// (TimeoutError) — cada chamador decide o que fazer com o erro (a maioria
// já tem fallback needs_human/mensagem de recuperação pra qualquer erro
// desta lib, não só timeout). CHAT_TIMEOUT_MS cobre os caminhos
// interativos (resposta de chat, extração estruturada, visão, PDF,
// embeddings); MEDIA_TIMEOUT_MS cobre geração de imagem/áudio, que já são
// naturalmente mais lentas.
const CHAT_TIMEOUT_MS = 30_000
const MEDIA_TIMEOUT_MS = 60_000

export type ChatMessage = { role: 'user' | 'assistant'; content: string }

export type OpenAiToolCall = { id: string; function: { name: string; arguments: string } }

/**
 * Igual a generateChatReply, mas com suporte a tool calling: se o modelo
 * pedir pra chamar uma ferramenta, `executeTool` decide o que fazer (rodar
 * uma ação real, como gerar QR do WhatsApp) e devolve o texto que volta pro
 * modelo terminar a resposta. Só dá 1 volta de tool calls (suficiente pro
 * caso de uso: 1 ação por turno) — se o modelo pedir de novo na 2ª resposta,
 * ignoramos e devolvemos o texto que ele mandar mesmo assim.
 */
export async function generateChatReplyWithTools<TExtra = unknown>(params: {
  apiKey: string
  systemPrompt: string
  history: ChatMessage[]
  tools: unknown[]
  executeTool: (toolCall: OpenAiToolCall) => Promise<{ forModel: string; extra?: TExtra }>
  model?: string
}): Promise<{ reply: string; extras: TExtra[] }> {
  const model = params.model ?? 'gpt-4o-mini'
  const baseMessages = [{ role: 'system', content: params.systemPrompt }, ...params.history]

  const firstResponse = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${params.apiKey}` },
    body: JSON.stringify({ model, messages: baseMessages, tools: params.tools, temperature: 0.7, max_tokens: 400 }),
    signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
  })
  const firstData = await firstResponse.json()
  if (!firstResponse.ok) {
    throw new Error(firstData?.error?.message ?? `OpenAI retornou status ${firstResponse.status}`)
  }
  await logOpenAIUsage({ endpoint: 'chat.completions', model, usage: firstData.usage })

  const choice = firstData.choices?.[0]
  const toolCalls: OpenAiToolCall[] = choice?.message?.tool_calls ?? []

  if (toolCalls.length === 0) {
    return { reply: (choice?.message?.content ?? '').trim(), extras: [] }
  }

  const extras: TExtra[] = []
  const toolMessages: { role: 'tool'; tool_call_id: string; content: string }[] = []
  for (const call of toolCalls) {
    const result = await params.executeTool(call)
    if (result.extra !== undefined) extras.push(result.extra)
    toolMessages.push({ role: 'tool', tool_call_id: call.id, content: result.forModel })
  }

  const secondResponse = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${params.apiKey}` },
    body: JSON.stringify({
      model,
      messages: [...baseMessages, choice.message, ...toolMessages],
      temperature: 0.7,
      max_tokens: 400,
    }),
    signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
  })
  const secondData = await secondResponse.json()
  if (!secondResponse.ok) {
    throw new Error(secondData?.error?.message ?? `OpenAI retornou status ${secondResponse.status}`)
  }
  await logOpenAIUsage({ endpoint: 'chat.completions', model, usage: secondData.usage })

  return { reply: (secondData.choices?.[0]?.message?.content ?? '').trim(), extras }
}

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
    signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
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
  /** Default 0.2 (extractors determinísticos). Suba pra manter tom conversacional quando a resposta em si vier deste schema (ex.: reply + attachment_id). */
  temperature?: number
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
      temperature: params.temperature ?? 0.2,
      max_tokens: params.maxTokens ?? 1500,
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
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
 * Igual a generateStructuredReply, mas manda uma imagem junto (Chat
 * Completions com content array — gpt-4o-mini tem visão nativa, não
 * precisa trocar de modelo). `imageUrl` pode ser uma URL pública normal
 * (ex.: arquivo recém-upload no Storage) ou uma data URL base64 — a API
 * da OpenAI aceita as duas formas do mesmo jeito. Usada pela extração
 * da ordem de serviço (lib/service-orders/extraction.ts).
 */
export async function generateStructuredReplyFromImage<T = Record<string, unknown>>(params: {
  apiKey: string
  systemPrompt: string
  imageUrl: string
  userText?: string
  model?: string
  maxTokens?: number
  temperature?: number
}): Promise<T> {
  const model = params.model ?? 'gpt-4o-mini'
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: params.systemPrompt },
        {
          role: 'user',
          content: [
            { type: 'text', text: params.userText ?? 'Analise a imagem anexada.' },
            { type: 'image_url', image_url: { url: params.imageUrl } },
          ],
        },
      ],
      temperature: params.temperature ?? 0.2,
      max_tokens: params.maxTokens ?? 1000,
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
  })

  const data = await response.json()

  if (!response.ok) {
    throw new Error(data?.error?.message ?? `OpenAI retornou status ${response.status}`)
  }

  await logOpenAIUsage({ endpoint: 'chat.completions.vision', model, usage: data.usage })

  const content = (data.choices?.[0]?.message?.content ?? '').trim()
  return JSON.parse(content) as T
}

/**
 * Igual a generateStructuredReplyFromImage, mas manda um PDF em vez de
 * imagem — Chat Completions aceita content part nativo `{ type: 'file',
 * file: { filename, file_data } }` desde 2025 (mesmo modelo com visão,
 * sem precisar converter em imagem nem rodar OCR à parte; `file_data` é
 * uma data URL base64, não aceita URL remota como o image_url aceita).
 * Usada pela extração da ordem de serviço quando o anexo é PDF
 * (lib/service-orders/extraction.ts).
 */
export async function generateStructuredReplyFromPdf<T = Record<string, unknown>>(params: {
  apiKey: string
  systemPrompt: string
  fileName: string
  base64Pdf: string
  userText?: string
  model?: string
  maxTokens?: number
  temperature?: number
}): Promise<T> {
  const model = params.model ?? 'gpt-4o-mini'
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: params.systemPrompt },
        {
          role: 'user',
          content: [
            { type: 'text', text: params.userText ?? 'Analise o documento anexado.' },
            {
              type: 'file',
              file: { filename: params.fileName, file_data: `data:application/pdf;base64,${params.base64Pdf}` },
            },
          ],
        },
      ],
      temperature: params.temperature ?? 0.2,
      max_tokens: params.maxTokens ?? 1000,
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
  })

  const data = await response.json()

  if (!response.ok) {
    throw new Error(data?.error?.message ?? `OpenAI retornou status ${response.status}`)
  }

  await logOpenAIUsage({ endpoint: 'chat.completions.pdf', model, usage: data.usage })

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
    signal: AbortSignal.timeout(MEDIA_TIMEOUT_MS),
  })

  const data = await response.json()

  if (!response.ok) {
    throw new Error(data?.error?.message ?? `OpenAI retornou status ${response.status}`)
  }

  return { text: (data.text ?? '').trim(), durationSeconds: Number(data.duration ?? 0) }
}

/**
 * Sintetiza um texto em áudio (voz) via TTS da OpenAI — espelha
 * `transcribeAudio` no sentido contrário. Devolve já em Ogg/Opus, o
 * formato que o WhatsApp espera para nota de voz (ptt), evitando
 * depender de ffmpeg (indisponível no runtime serverless da Vercel).
 *
 * Voz padrão 'shimmer' (trocada de 'alloy' — reportada como robótica em
 * atendimento real) e `instructions` de tom, ambos suportados pelo
 * gpt-4o-mini-tts (diferente do tts-1/tts-1-hd, que ignoram `instructions`).
 */
export async function synthesizeSpeech(params: {
  apiKey: string
  text: string
  voice?: string
}): Promise<{ base64Audio: string; mimeType: string }> {
  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini-tts',
      input: params.text,
      voice: params.voice ?? 'shimmer',
      instructions:
        'Fale em tom natural, caloroso e humano, como uma pessoa de verdade numa nota de voz do WhatsApp — nem robótico nem apressado, com entonação e ritmo variados.',
      response_format: 'opus',
    }),
    signal: AbortSignal.timeout(MEDIA_TIMEOUT_MS),
  })

  if (!response.ok) {
    const data = await response.json().catch(() => null)
    throw new Error(data?.error?.message ?? `OpenAI retornou status ${response.status}`)
  }

  const arrayBuffer = await response.arrayBuffer()
  return { base64Audio: Buffer.from(arrayBuffer).toString('base64'), mimeType: 'audio/ogg; codecs=opus' }
}

/**
 * Gera uma imagem (gpt-image-1) a partir de um prompt em texto — usada
 * pelo funcionário digital de Conteúdo/Social para ilustrar posts.
 * Sempre devolve base64 (gpt-image-1 não aceita response_format: 'url';
 * quem chama decide o que fazer com os bytes — aqui, upload no Storage).
 */
export async function generateImage(params: {
  apiKey: string
  prompt: string
  size?: '1024x1024' | '1024x1536' | '1536x1024'
  quality?: 'low' | 'medium' | 'high'
}): Promise<{ base64Image: string }> {
  const quality = params.quality ?? 'medium'
  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-image-1',
      prompt: params.prompt,
      size: params.size ?? '1024x1024',
      quality,
      n: 1,
    }),
    signal: AbortSignal.timeout(MEDIA_TIMEOUT_MS),
  })

  const data = await response.json()

  if (!response.ok) {
    throw new Error(data?.error?.message ?? `OpenAI retornou status ${response.status}`)
  }

  const base64Image = data?.data?.[0]?.b64_json
  if (!base64Image) {
    throw new Error('OpenAI não retornou a imagem gerada.')
  }

  await logOpenAIImageUsage({ quality })

  return { base64Image }
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
    signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
  })

  const data = await response.json()

  if (!response.ok) {
    throw new Error(data?.error?.message ?? `OpenAI retornou status ${response.status}`)
  }

  await logOpenAIUsage({ endpoint: 'embeddings', model: 'text-embedding-3-small', usage: data.usage })

  const rows = (data.data ?? []) as { index: number; embedding: number[] }[]
  return rows.sort((a, b) => a.index - b.index).map((row) => row.embedding)
}
