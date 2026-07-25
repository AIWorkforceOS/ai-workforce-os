// Geração de imagem de criativo do Gestor de Tráfego Pago, reaproveitando
// o mesmo motor do funcionário Conteúdo/Social (lib/content/generator.ts):
// gpt-image-1 via lib/openai.ts, mesma OPENAI_API_KEY já configurada.
//
// Diferença de contexto: aqui a legenda/headline do anúncio já vem pronta
// (quem chama já decidiu o texto, ver NewCampaignSpec.creative) — não
// geramos texto, só o prompt de imagem + a imagem, a partir do texto do
// anúncio, do público-alvo e da ficha de negócio (mesma personalização
// usada nos outros funcionários via buildCombinedBusinessContext).

import type { SupabaseClient } from '@supabase/supabase-js'
import { generateImage, generateStructuredReply } from '@/lib/openai'
import { buildCombinedBusinessContext } from '@/lib/interview/engine'
import type { AdPlatform, CampaignCreative, CampaignTargeting } from './types'

type ImagePromptOutput = { image_prompt?: string; reasoning?: string }

export type GeneratedCreativeImagePrompt = {
  imagePrompt: string
  reasoning: string
}

/**
 * Google Ads só tem fluxo de anúncio completo para SEARCH nesta rodada
 * (Responsive Search Ad — texto puro, sem imagem; ver google-ads.ts) —
 * Search não usa imagem, então não forçamos geração para esse canal.
 * Display/Performance Max usam "asset groups" com imagem obrigatória:
 * geramos e deixamos aprovável, mesmo sem a criação do asset group em si
 * estar implementada nesta rodada (mesma limitação documentada em
 * launcher.ts). Meta sempre usa imagem — todo objective aceita `picture`
 * no adcreative (object_story_spec.link_data).
 */
export function isImageApplicable(platform: AdPlatform, objective: string): boolean {
  if (platform === 'meta') return true
  return objective.trim().toUpperCase() !== 'SEARCH'
}

function targetingSummary(targeting: CampaignTargeting): string {
  const parts = [`países: ${targeting.countries.join(', ') || 'não informado'}`]
  if (targeting.ageMin || targeting.ageMax) {
    parts.push(`idade: ${targeting.ageMin ?? 18}–${targeting.ageMax ?? 65}`)
  }
  return parts.join('; ')
}

/** Monta o prompt de sistema (função pura, testável sem rede). */
export function buildCreativeImageSystemPrompt(params: {
  platform: AdPlatform
  objective: string
  creative: Pick<CampaignCreative, 'headline' | 'body'>
  targeting: CampaignTargeting
  organizationProfile: Record<string, unknown> | null
  agentBusinessProfile: Record<string, unknown> | null
}): string {
  const { platform, objective, creative, targeting, organizationProfile, agentBusinessProfile } = params
  const businessContext = buildCombinedBusinessContext(organizationProfile, agentBusinessProfile)
  return [
    `Você é o(a) gestor(a) de tráfego pago digital, criando o criativo visual de um anúncio para ${platform === 'meta' ? 'Meta Ads (Instagram/Facebook)' : 'Google Ads'}.`,
    `Objetivo da campanha: ${objective}. Público-alvo: ${targetingSummary(targeting)}.`,
    `Texto do anúncio já decidido — título: "${creative.headline}". Corpo: "${creative.body}".`,
    businessContext ??
      'Ainda não há uma ficha de negócio detalhada — descreva algo genérico, seguro e verdadeiro para uma empresa de serviços, sem inventar detalhes específicos.',
    'Nunca invente promoção, preço ou resultado que não esteja na ficha da empresa. Nunca mencione concorrentes. Respeite qualquer proibição registrada na ficha.',
    'FORMATO DA RESPOSTA — responda SOMENTE um JSON válido no formato:',
    '{"image_prompt": "descrição em inglês, detalhada e visual, formato paisagem adequado para anúncio pago, coerente com o título/corpo e o público-alvo — sem nenhum texto/letra/logotipo embutido na imagem", "reasoning": "1 frase curta, em português, explicando a escolha visual, para o dono da empresa entender"}',
  ]
    .filter(Boolean)
    .join(' ')
}

/** Traduz o texto do anúncio + contexto de negócio num prompt de imagem via chat (JSON mode). */
export async function generateCreativeImagePrompt(params: {
  apiKey: string
  platform: AdPlatform
  objective: string
  creative: Pick<CampaignCreative, 'headline' | 'body'>
  targeting: CampaignTargeting
  organizationProfile: Record<string, unknown> | null
  agentBusinessProfile: Record<string, unknown> | null
}): Promise<GeneratedCreativeImagePrompt> {
  const systemPrompt = buildCreativeImageSystemPrompt(params)
  const output = await generateStructuredReply<ImagePromptOutput>({
    apiKey: params.apiKey,
    systemPrompt,
    history: [{ role: 'user', content: 'Gere o prompt de imagem agora.' }],
    maxTokens: 400,
    temperature: 0.8,
  })

  const imagePrompt = (output.image_prompt ?? '').trim()
  const reasoning = (output.reasoning ?? '').trim()
  if (!imagePrompt) {
    throw new Error('OpenAI não retornou um prompt de imagem válido para o criativo.')
  }
  return { imagePrompt, reasoning: reasoning || 'Imagem gerada a partir do texto do anúncio e do público-alvo.' }
}

/** Gera a imagem (gpt-image-1) a partir do prompt textual do criativo — formato paisagem, próximo do 1.91:1 recomendado para anúncios. */
export async function generateCampaignCreativeImage(params: {
  apiKey: string
  imagePrompt: string
}): Promise<{ base64Image: string }> {
  return generateImage({ apiKey: params.apiKey, prompt: params.imagePrompt, size: '1536x1024', quality: 'medium' })
}

/**
 * Sobe a imagem gerada para o Storage (bucket content-media, mesmo bucket
 * do funcionário Conteúdo/Social — ver decisão na migration 041) e
 * devolve a URL pública — necessária porque a Meta busca a imagem do
 * criativo por URL (object_story_spec.link_data.picture).
 */
export async function uploadCampaignCreativeImage(params: {
  supabase: SupabaseClient
  unitId: string
  base64Image: string
}): Promise<string> {
  const buffer = Buffer.from(params.base64Image, 'base64')
  const path = `${params.unitId}/traffic/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`
  const { error } = await params.supabase.storage
    .from('content-media')
    .upload(path, buffer, { contentType: 'image/png', upsert: false })
  if (error) throw new Error(`Falha ao subir a imagem do criativo: ${error.message}`)
  const { data } = params.supabase.storage.from('content-media').getPublicUrl(path)
  return data.publicUrl
}
