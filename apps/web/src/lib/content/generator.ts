// Geração de conteúdo (legenda + imagem) do funcionário Conteúdo/Social,
// usando a mesma OPENAI_API_KEY já configurada no projeto
// (lib/openai.ts). Legenda via chat (JSON mode); imagem via gpt-image-1.

import type { SupabaseClient } from '@supabase/supabase-js'
import { generateImage, generateStructuredReply } from '@/lib/openai'
import { buildCombinedBusinessContext } from '@/lib/interview/engine'
import type { AgentConfig, Unit } from '@/lib/types'
import type { SocialPlatform } from './types'

type CaptionOutput = { caption?: string; image_prompt?: string; reasoning?: string }

export type GeneratedPostContent = {
  caption: string
  imagePrompt: string
  reasoning: string
}

function platformLabel(platform: SocialPlatform): string {
  return platform === 'instagram' ? 'Instagram' : 'Facebook'
}

/**
 * Monta o prompt de sistema da geração de post — função pura (testável
 * sem rede), no mesmo espírito de buildInterviewerPrompt.
 */
export function buildCaptionSystemPrompt(params: {
  config: AgentConfig
  unit: Unit
  organizationProfile: Record<string, unknown> | null
  platform: SocialPlatform
  pillar: string | null
}): string {
  const { config, unit, organizationProfile, platform, pillar } = params
  const businessContext = buildCombinedBusinessContext(organizationProfile, config.business_profile)
  return [
    `Você é ${config.persona_name}, gestor(a) de conteúdo e redes sociais digital da unidade ${unit.name}.`,
    `Sua tarefa agora: criar UM post orgânico para o ${platformLabel(platform)}${pillar ? `, sobre o pilar de conteúdo "${pillar}"` : ''}.`,
    businessContext ??
      'Ainda não há uma ficha de negócio detalhada — escreva algo genérico, seguro e verdadeiro para uma empresa de serviços, sem inventar detalhes específicos.',
    'A legenda deve soar humana, natural, sem parecer gerada por IA e sem clichês genéricos de marketing. Use no máximo 2 emojis, só se fizer sentido para o tom da marca.',
    'Nunca invente promoção, preço ou resultado que não esteja na ficha da empresa. Nunca mencione concorrentes. Respeite qualquer proibição registrada na ficha.',
    'FORMATO DA RESPOSTA — responda SOMENTE um JSON válido no formato:',
    '{"caption": "a legenda pronta para publicar, incluindo call to action se fizer sentido para a empresa", "image_prompt": "descrição em inglês, detalhada e visual, para gerar a imagem que acompanha o post — sem nenhum texto/letra embutido na imagem", "reasoning": "1 frase curta, em português, explicando por que este post faz sentido agora, para o dono da empresa entender"}',
  ]
    .filter(Boolean)
    .join(' ')
}

/** Gera legenda + prompt de imagem (texto) via chat em JSON mode. */
export async function generatePostContent(params: {
  apiKey: string
  config: AgentConfig
  unit: Unit
  organizationProfile: Record<string, unknown> | null
  platform: SocialPlatform
  pillar: string | null
}): Promise<GeneratedPostContent> {
  const systemPrompt = buildCaptionSystemPrompt(params)
  const output = await generateStructuredReply<CaptionOutput>({
    apiKey: params.apiKey,
    systemPrompt,
    history: [{ role: 'user', content: 'Gere o post agora.' }],
    maxTokens: 500,
    temperature: 0.8,
  })

  const caption = (output.caption ?? '').trim()
  const imagePrompt = (output.image_prompt ?? '').trim()
  const reasoning = (output.reasoning ?? '').trim()
  if (!caption || !imagePrompt) {
    throw new Error('OpenAI não retornou legenda ou prompt de imagem válidos para o post.')
  }
  return { caption, imagePrompt, reasoning: reasoning || 'Post gerado conforme a frequência configurada pela empresa.' }
}

/** Gera a imagem (gpt-image-1) a partir do prompt textual do post. */
export async function generatePostImage(params: { apiKey: string; imagePrompt: string }): Promise<{ base64Image: string }> {
  return generateImage({ apiKey: params.apiKey, prompt: params.imagePrompt, size: '1024x1024', quality: 'medium' })
}

/**
 * Sobe a imagem gerada para o Storage (bucket content-media, migration
 * 040) e devolve a URL pública — necessária porque a Graph API busca a
 * imagem por URL, não aceita upload direto de bytes.
 */
export async function uploadGeneratedImage(params: {
  supabase: SupabaseClient
  unitId: string
  base64Image: string
}): Promise<string> {
  const buffer = Buffer.from(params.base64Image, 'base64')
  const path = `${params.unitId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`
  const { error } = await params.supabase.storage
    .from('content-media')
    .upload(path, buffer, { contentType: 'image/png', upsert: false })
  if (error) throw new Error(`Falha ao subir a imagem gerada: ${error.message}`)
  const { data } = params.supabase.storage.from('content-media').getPublicUrl(path)
  return data.publicUrl
}
