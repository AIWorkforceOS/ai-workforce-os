import { generateStructuredReplyFromImage, getOpenAIApiKey, transcribeAudio } from '@/lib/openai'

export type PartnerSupportMedia = {
  kind: 'image' | 'audio'
  mimeType: string
  base64: string
  caption?: string | null
  sourceMessageId?: string | null
}

const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const MAX_AUDIO_BYTES = 16 * 1024 * 1024

export async function analyzePartnerSupportMedia(media: PartnerSupportMedia[]): Promise<string[]> {
  if (media.length === 0) return []
  const apiKey = getOpenAIApiKey()
  if (!apiKey) throw new Error('OPENAI_API_KEY não está configurada para analisar a mídia do chamado.')

  return Promise.all(media.map(async (item, index) => {
    const bytes = Buffer.byteLength(item.base64, 'base64')
    if (bytes <= 0) throw new Error(`Mídia ${index + 1} está vazia.`)

    if (item.kind === 'audio') {
      if (!item.mimeType.startsWith('audio/') || bytes > MAX_AUDIO_BYTES) {
        throw new Error(`Áudio ${index + 1} tem formato ou tamanho inválido.`)
      }
      const result = await transcribeAudio({ apiKey, base64Audio: item.base64, mimeType: item.mimeType })
      if (!result.text) throw new Error(`Áudio ${index + 1} não produziu transcrição.`)
      return `Áudio ${index + 1} transcrito (${result.durationSeconds.toFixed(1)}s): ${result.text}`
    }

    if (!item.mimeType.startsWith('image/') || bytes > MAX_IMAGE_BYTES) {
      throw new Error(`Imagem ${index + 1} tem formato ou tamanho inválido.`)
    }
    const result = await generateStructuredReplyFromImage<{
      description?: string
      visible_text?: string
      uncertainty?: string
    }>({
      apiKey,
      systemPrompt: [
        'Analise uma imagem anexada a um chamado técnico de software.',
        'Descreva somente o que estiver visível, incluindo tela, mensagens de erro, campos e caminho aparente.',
        'Não invente causa, credencial, dado pessoal ou ação executada.',
        'Responda em JSON com description, visible_text e uncertainty, todos strings.',
      ].join(' '),
      imageUrl: `data:${item.mimeType};base64,${item.base64}`,
      userText: item.caption || 'Leia esta evidência visual do problema relatado.',
      maxTokens: 800,
    })
    const details = [
      result.description?.trim(),
      result.visible_text?.trim() ? `Texto visível: ${result.visible_text.trim()}` : null,
      result.uncertainty?.trim() ? `Limitações: ${result.uncertainty.trim()}` : null,
    ].filter((part): part is string => Boolean(part))
    if (details.length === 0) throw new Error(`Imagem ${index + 1} não produziu análise.`)
    return `Imagem ${index + 1}: ${details.join(' ')}`
  }))
}
