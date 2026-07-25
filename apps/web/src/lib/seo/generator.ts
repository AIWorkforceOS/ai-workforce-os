// Geração de conteúdo do funcionário digital de SEO — reaproveita o
// mesmo motor de texto (generateStructuredReply) e imagem (generateImage,
// gpt-image-1) já usado pelo Conteúdo/Social e pelo retrofit de imagem do
// Tráfego (lib/openai.ts, mesma OPENAI_API_KEY), com prompts próprios por
// tipo de conteúdo: post de blog, landing page, descrição de Google
// Business Profile e post de atualização de GBP.

import type { SupabaseClient } from '@supabase/supabase-js'
import { generateImage, generateStructuredReply } from '@/lib/openai'
import { buildCombinedBusinessContext } from '@/lib/interview/engine'
import type { AgentConfig, Unit } from '@/lib/types'
import type { SeoContentType } from './types'

type SeoContentOutput = {
  title?: string
  meta_description?: string
  body_markdown?: string
  image_prompt?: string
  reasoning?: string
}

export type GeneratedSeoContent = {
  title: string
  metaDescription: string | null
  bodyMarkdown: string
  imagePrompt: string | null
  reasoning: string
}

const CONTENT_TYPE_INSTRUCTIONS: Record<SeoContentType, string> = {
  blog: 'Escreva um POST DE BLOG completo em markdown (600–900 palavras), com subtítulos (##) organizando o conteúdo, mirando a palavra-chave alvo de forma natural (sem repetição forçada/keyword stuffing). Inclua um título otimizado (com a palavra-chave) e uma meta description (120–160 caracteres).',
  landing_page: 'Escreva o COPY de uma LANDING PAGE curta e persuasiva em markdown (300–500 palavras: headline, benefícios, prova/confiança quando a ficha da empresa permitir, chamada para ação clara), mirando a palavra-chave alvo. Inclua um título otimizado e uma meta description (120–160 caracteres).',
  gbp_description:
    'Escreva a DESCRIÇÃO DO NEGÓCIO para o perfil do Google Business Profile (Google Meu Negócio): até 750 caracteres, em texto corrido (sem markdown), apresentando a empresa, o que ela oferece e por que escolher ela — sem promessas exageradas. Não use palavra-chave alvo forçada; "title" pode ser só "Descrição do Google Business Profile" e "meta_description" pode ficar vazio.',
  gbp_post: 'Escreva um POST DE ATUALIZAÇÃO para o Google Business Profile (Google Posts): curto (150–300 caracteres), em texto corrido (sem markdown), sobre uma novidade/serviço/dica da empresa, com uma chamada para ação simples ao final. "title" é um resumo curto do post; "meta_description" pode ficar vazio.',
}

function contentTypeLabel(contentType: SeoContentType): string {
  switch (contentType) {
    case 'blog':
      return 'post de blog'
    case 'landing_page':
      return 'landing page'
    case 'gbp_description':
      return 'descrição do Google Business Profile'
    case 'gbp_post':
      return 'post de atualização do Google Business Profile'
  }
}

/** Monta o prompt de sistema da geração de conteúdo — função pura, testável sem rede. */
export function buildSeoContentSystemPrompt(params: {
  config: AgentConfig
  unit: Unit
  organizationProfile: Record<string, unknown> | null
  contentType: SeoContentType
  keyword: string | null
}): string {
  const { config, unit, organizationProfile, contentType, keyword } = params
  const businessContext = buildCombinedBusinessContext(organizationProfile, config.business_profile)
  return [
    `Você é ${config.persona_name}, especialista em SEO digital da unidade ${unit.name}.`,
    `Sua tarefa agora: criar um(a) ${contentTypeLabel(contentType)}${keyword ? ` mirando a palavra-chave "${keyword}"` : ''}.`,
    CONTENT_TYPE_INSTRUCTIONS[contentType],
    businessContext ??
      'Ainda não há uma ficha de negócio detalhada — escreva algo genérico, seguro e verdadeiro para uma empresa de serviços, sem inventar detalhes específicos.',
    'O texto deve soar humano e natural, sem parecer gerado por IA e sem clichês genéricos de marketing.',
    'Nunca invente promoção, preço ou resultado que não esteja na ficha da empresa. Nunca mencione concorrentes pelo nome. Respeite qualquer proibição registrada na ficha.',
    'FORMATO DA RESPOSTA — responda SOMENTE um JSON válido no formato:',
    '{"title": "título do conteúdo", "meta_description": "meta description (ou string vazia quando não se aplicar)", "body_markdown": "o conteúdo completo, pronto para publicar", "image_prompt": "descrição em inglês, detalhada e visual, para gerar uma imagem que acompanha o conteúdo — sem nenhum texto/letra embutido na imagem", "reasoning": "1 frase curta, em português, explicando por que este conteúdo faz sentido agora, para o dono da empresa entender"}',
  ]
    .filter(Boolean)
    .join(' ')
}

/** Gera o conteúdo (texto) via chat em JSON mode. */
export async function generateSeoContent(params: {
  apiKey: string
  config: AgentConfig
  unit: Unit
  organizationProfile: Record<string, unknown> | null
  contentType: SeoContentType
  keyword: string | null
}): Promise<GeneratedSeoContent> {
  const systemPrompt = buildSeoContentSystemPrompt(params)
  const output = await generateStructuredReply<SeoContentOutput>({
    apiKey: params.apiKey,
    systemPrompt,
    history: [{ role: 'user', content: 'Gere o conteúdo agora.' }],
    maxTokens: 1800,
    temperature: 0.7,
  })

  const title = (output.title ?? '').trim()
  const bodyMarkdown = (output.body_markdown ?? '').trim()
  const metaDescription = (output.meta_description ?? '').trim()
  const imagePrompt = (output.image_prompt ?? '').trim()
  const reasoning = (output.reasoning ?? '').trim()

  if (!title || !bodyMarkdown) {
    throw new Error('OpenAI não retornou título ou conteúdo válidos.')
  }

  return {
    title,
    metaDescription: metaDescription || null,
    bodyMarkdown,
    imagePrompt: imagePrompt || null,
    reasoning: reasoning || 'Conteúdo gerado conforme a rotina de SEO configurada.',
  }
}

/** Gera a imagem (gpt-image-1) a partir do prompt textual do conteúdo. */
export async function generateSeoImage(params: { apiKey: string; imagePrompt: string }): Promise<{ base64Image: string }> {
  return generateImage({ apiKey: params.apiKey, prompt: params.imagePrompt, size: '1024x1024', quality: 'medium' })
}

/**
 * Sobe a imagem gerada para o Storage (bucket content-media, migration
 * 040) num subcaminho próprio do SEO — mesmo bucket reaproveitado pelo
 * Tráfego (migration 041, path unit_id/traffic/...), nenhuma policy nova
 * necessária.
 */
export async function uploadSeoImage(params: { supabase: SupabaseClient; unitId: string; base64Image: string }): Promise<string> {
  const buffer = Buffer.from(params.base64Image, 'base64')
  const path = `${params.unitId}/seo/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`
  const { error } = await params.supabase.storage.from('content-media').upload(path, buffer, { contentType: 'image/png', upsert: false })
  if (error) throw new Error(`Falha ao subir a imagem gerada: ${error.message}`)
  const { data } = params.supabase.storage.from('content-media').getPublicUrl(path)
  return data.publicUrl
}
