// Geração de conteúdo (legenda + imagem) do funcionário Conteúdo/Social,
// usando a mesma OPENAI_API_KEY já configurada no projeto
// (lib/openai.ts). Legenda via chat (JSON mode); imagem via gpt-image-1.

import type { SupabaseClient } from '@supabase/supabase-js'
import sharp from 'sharp'
import { generateImage, generateStructuredReply } from '@/lib/openai'
import { buildCombinedBusinessContext } from '@/lib/interview/engine'
import { detectBusinessLanguage } from './language'
import type { AgentConfig, Unit } from '@/lib/types'
import type { SocialPlatform } from './types'

/** Ficha da Empresa compartilhada carrega opcionalmente a identidade visual (logo + paleta) — ver api/content/brand-kit. */
export type BrandKit = { logo_url?: string | null; primary_color?: string | null; secondary_color?: string | null }

function brandKitFrom(organizationProfile: Record<string, unknown> | null | undefined): BrandKit | null {
  const raw = (organizationProfile as { brand_kit?: BrandKit } | null | undefined)?.brand_kit
  if (!raw || (!raw.logo_url && !raw.primary_color && !raw.secondary_color)) return null
  return raw
}

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
  /** Nome da data comemorativa em que este post vai ao ar, se houver (planejamento semanal, ver lib/content/holidays.ts). */
  holiday?: string | null
}): string {
  const { config, unit, organizationProfile, platform, pillar, holiday } = params
  const businessContext = buildCombinedBusinessContext(organizationProfile, config.business_profile)
  const detectedLanguage = detectBusinessLanguage([organizationProfile, config.business_profile])
  const brandKit = brandKitFrom(organizationProfile)

  return [
    `Você é ${config.persona_name}, gestor(a) de conteúdo e redes sociais digital da unidade ${unit.name}.`,
    `Sua tarefa agora: criar UM post orgânico para o ${platformLabel(platform)}${pillar ? `, sobre o pilar de conteúdo "${pillar}"` : ''}.`,
    businessContext ??
      'Ainda não há uma ficha de negócio detalhada — escreva algo genérico, seguro e verdadeiro para uma empresa de serviços, sem inventar detalhes específicos.',
    'A legenda deve soar humana, natural, sem parecer gerada por IA e sem clichês genéricos de marketing. Use no máximo 2 emojis, só se fizer sentido para o tom da marca.',
    'Nunca invente promoção, preço ou resultado que não esteja na ficha da empresa. Nunca mencione concorrentes. Respeite qualquer proibição registrada na ficha.',
    `Idioma da legenda: escreva a legenda inteiramente em ${detectedLanguage === 'en' ? 'inglês' : 'português'} — esse idioma foi detectado automaticamente lendo o texto real da ficha da empresa acima (não confie em nenhum campo de configuração isolado de idioma, ele pode estar errado ou ausente). O "reasoning" continua em português (é só para o dono da empresa entender, no painel); o "image_prompt" continua em inglês (é só para o gerador de imagem).`,
    brandKit
      ? `Identidade visual da marca: ao descrever a imagem (image_prompt), use como cores predominantes da cena${brandKit.primary_color ? ` a cor primária ${brandKit.primary_color}` : ''}${brandKit.secondary_color ? ` e a cor secundária ${brandKit.secondary_color}` : ''} — mantenha consistência visual com os outros posts da marca.`
      : null,
    holiday
      ? `Data comemorativa: este post vai ao ar em "${holiday}" — aproveite a ocasião no post (legenda e imagem), conectando com o negócio quando fizer sentido, sem forçar. Nunca invente que a empresa está fechada, aberta, com promoção ou horário especial nessa data a menos que isso já esteja escrito na ficha do negócio.`
      : null,
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
  holiday?: string | null
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

/**
 * Gera a imagem (gpt-image-1) a partir do prompt textual do post e, se a
 * marca tiver logo cadastrado (brand kit), compõe o logo por cima antes de
 * devolver — a cor já foi pedida no prompt (buildCaptionSystemPrompt), mas
 * o logo em si nenhum gerador de imagem reproduz de forma consistente só
 * por descrição textual, por isso ele é colado de verdade na imagem final.
 */
export async function generatePostImage(params: {
  apiKey: string
  imagePrompt: string
  logoUrl?: string | null
}): Promise<{ base64Image: string }> {
  const { base64Image } = await generateImage({ apiKey: params.apiKey, prompt: params.imagePrompt, size: '1024x1024', quality: 'medium' })
  if (!params.logoUrl) return { base64Image }

  try {
    return { base64Image: await compositeLogoOntoImage(base64Image, params.logoUrl) }
  } catch (error) {
    // Nunca bloqueia o post por causa do logo — publica sem marca em vez de derrubar o pipeline inteiro.
    console.error('[content/generator] falha ao compor o logo na imagem, seguindo sem ele:', error instanceof Error ? error.message : error)
    return { base64Image }
  }
}

/** Cola o logo da marca no canto inferior direito da imagem gerada (padding + redimensionamento proporcionais ao tamanho da imagem). */
async function compositeLogoOntoImage(baseImageBase64: string, logoUrl: string): Promise<string> {
  const baseBuffer = Buffer.from(baseImageBase64, 'base64')
  const logoResponse = await fetch(logoUrl)
  if (!logoResponse.ok) throw new Error(`Não foi possível baixar o logo da marca (status ${logoResponse.status}).`)
  const logoBuffer = Buffer.from(await logoResponse.arrayBuffer())

  const baseMeta = await sharp(baseBuffer).metadata()
  const baseWidth = baseMeta.width ?? 1024
  const baseHeight = baseMeta.height ?? 1024

  const targetLogoWidth = Math.round(baseWidth * 0.18)
  const resizedLogo = await sharp(logoBuffer)
    .resize({ width: targetLogoWidth, fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer()
  const logoMeta = await sharp(resizedLogo).metadata()

  const padding = Math.round(baseWidth * 0.03)
  const left = Math.max(0, baseWidth - (logoMeta.width ?? targetLogoWidth) - padding)
  const top = Math.max(0, baseHeight - (logoMeta.height ?? targetLogoWidth) - padding)

  const composited = await sharp(baseBuffer)
    .composite([{ input: resizedLogo, left, top }])
    .png()
    .toBuffer()
  return composited.toString('base64')
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
