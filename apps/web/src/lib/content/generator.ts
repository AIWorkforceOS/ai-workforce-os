// Geração de conteúdo (legenda + imagem) do funcionário Conteúdo/Social,
// usando a mesma OPENAI_API_KEY já configurada no projeto
// (lib/openai.ts). Legenda via chat (JSON mode); imagem via gpt-image-2.

import type { SupabaseClient } from '@supabase/supabase-js'
import { generateImage, generateStructuredReply } from '@/lib/openai'
import { buildCombinedBusinessContext } from '@/lib/interview/engine'
import { brandKitFrom, compositeLogoOntoImage, type BrandKit } from '@/lib/brand-kit'
import { resolveContentLanguage } from './language'
import type { AgentConfig, Unit } from '@/lib/types'
import type { SocialPlatform } from './types'

export type { BrandKit }

type CaptionOutput = { caption?: string; image_prompt?: string; reasoning?: string }

export type GeneratedPostContent = {
  caption: string
  imagePrompt: string
  reasoning: string
}

/** Resumo de um post recente, usado só pra dar contexto ao gerador (evitar repetição) — ver buildRecentPostsContext. */
export type RecentPostSummary = { pillar: string | null; caption: string; imagePrompt: string | null }

const RECENT_POSTS_FOR_CONTEXT = 6
const RECENT_TEXT_TRUNCATE = 100

function truncate(text: string, max: number): string {
  const trimmed = text.trim()
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed
}

/**
 * Monta o bloco "posts recentes desta conta" do prompt (pedido do
 * Vinicius, 2026-08-23: parou de "postar por postar" e repetir a mesma
 * cena/ângulo em imagens diferentes só porque o pilar mudou). Mostra
 * pilar + legenda + conceito visual dos últimos posts pra o modelo
 * conseguir de fato variar tema E composição, em vez de gerar no vácuo.
 */
function buildRecentPostsContext(recentPosts: RecentPostSummary[] | undefined): string | null {
  if (!recentPosts || recentPosts.length === 0) return null
  const items = recentPosts.slice(0, RECENT_POSTS_FOR_CONTEXT).map((post, i) => {
    const pillarLabel = post.pillar ? `[${post.pillar}]` : '[sem pilar]'
    const captionPart = truncate(post.caption, RECENT_TEXT_TRUNCATE)
    const imagePart = post.imagePrompt ? ` | cena: ${truncate(post.imagePrompt, RECENT_TEXT_TRUNCATE)}` : ''
    return `${i + 1}. ${pillarLabel} ${captionPart}${imagePart}`
  })
  return `POSTS RECENTES DESTA CONTA (mais novo primeiro) — não repita o mesmo tema, gancho ou cena/composição visual de nenhum deles: ${items.join(' / ')}`
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
  /** Últimos posts da conta, pra não repetir tema/cena (pedido do Vinicius, 2026-08-23: parar de "postar por postar"). */
  recentPosts?: RecentPostSummary[]
  /** Materiais da biblioteca aplicáveis a 'content_specialist' (lib/attachments.ts) — pedido do Vinicius (2026-08-26): criativos ruins por falta de referência real da empresa (cardápio, catálogo, identidade visual em PDF etc.), este era um dos 3 cargos que ainda não liam a biblioteca. */
  attachmentsContext?: string | null
}): string {
  const { config, unit, organizationProfile, platform, pillar, holiday, recentPosts, attachmentsContext } = params
  const businessContext = buildCombinedBusinessContext(organizationProfile, config.business_profile)
  // idioma_conteudo (achado real, 2026-08-27): pedido explícito do dono na
  // entrevista/retreinamento ("todos os posts em inglês") tem prioridade
  // sobre o idioma padrão da unidade — sem isso, resolveContentLanguage
  // nunca via essa instrução (ela ficava só em texto livre, que o
  // detector de idioma nem lê) e o post saía sempre no idioma da unidade,
  // ignorando o que foi pedido.
  const explicitContentLanguage = (config.business_profile as Record<string, unknown> | null)?.idioma_conteudo
  const detectedLanguage =
    explicitContentLanguage === 'pt' || explicitContentLanguage === 'en'
      ? explicitContentLanguage
      : resolveContentLanguage(unit.default_conversation_language, [organizationProfile, config.business_profile])
  const brandKit = brandKitFrom(organizationProfile)
  const recentPostsContext = buildRecentPostsContext(recentPosts)

  return [
    `Você é ${config.persona_name}, gestor(a) de conteúdo e redes sociais digital da unidade ${unit.name}.`,
    `Sua tarefa agora: criar UM post orgânico para o ${platformLabel(platform)}${pillar ? `, sobre o pilar de conteúdo "${pillar}"` : ''}.`,
    businessContext ??
      'Ainda não há uma ficha de negócio detalhada — escreva algo genérico, seguro e verdadeiro para uma empresa de serviços, sem inventar detalhes específicos.',
    'Aja como um gestor de conteúdo de verdade, não como quem posta por postar: antes de escrever, decida qual ângulo/formato (dica prática, resultado real com problema→solução, bastidores da equipe, prova social, pergunta pro público, educativo, autoridade no assunto etc.) tem mais chance de gerar resultado de negócio de verdade — leads qualificados, confiança, autoridade — para ESTE pilar e para o público-alvo descrito na ficha. Nunca gere um post genérico só para preencher a grade de publicação.',
    // Achado real (2026-08-28, conta AlizoAi): pra negócio abstrato
    // (ex.: SaaS/tecnologia, sem produto físico pra fotografar), o modelo
    // sempre "caía" no mesmo clichê visual — escritório moderno com telas
    // mostrando gráficos, em azul/turquesa — mesmo com a instrução de não
    // repetir cena. Enumerar formatos concretos pra alternar de verdade
    // funciona melhor do que só pedir "não repita".
    'VARIEDADE VISUAL DE VERDADE (não só "não repetir a última cena" — alterne de propósito entre formatos diferentes a cada post, mesmo pra negócios sem produto físico): fotografia realista de pessoas/ambiente, ilustração/composição gráfica abstrata, close-up de um objeto/detalhe específico, peça no estilo infográfico/dado visual, cena minimalista com um único elemento em destaque, comparação antes/depois, ou um personagem/mascote em ação. Nunca use o MESMO formato do post imediatamente anterior (ver histórico abaixo) — se ele foi "escritório com telas", o de agora tem que ser outra coisa, não uma variação da mesma ideia.',
    recentPostsContext,
    attachmentsContext || null,
    'A legenda deve soar humana, natural, sem parecer gerada por IA e sem clichês genéricos de marketing. Use no máximo 2 emojis, só se fizer sentido para o tom da marca.',
    'Nunca invente promoção, preço ou resultado que não esteja na ficha da empresa. Nunca mencione concorrentes. Respeite qualquer proibição registrada na ficha.',
    `Idioma da legenda: escreva a legenda inteiramente em ${detectedLanguage === 'en' ? 'inglês' : 'português'} — esse é o idioma em que o negócio atende seus clientes (configurado na unidade, ou detectado a partir da ficha quando esse dado não existe). O "reasoning" continua em português (é só para o dono da empresa entender, no painel); o "image_prompt" continua em inglês (é só para o gerador de imagem).`,
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
  recentPosts?: RecentPostSummary[]
  attachmentsContext?: string | null
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
 * Gera a imagem (gpt-image-2) a partir do prompt textual do post e, se a
 * marca tiver logo cadastrado (brand kit), compõe o logo por cima antes de
 * devolver — a cor já foi pedida no prompt (buildCaptionSystemPrompt), mas
 * o logo em si nenhum gerador de imagem reproduz de forma consistente só
 * por descrição textual, por isso ele é colado de verdade na imagem final.
 *
 * Quando a marca tem logo cadastrado, ele é OBRIGATÓRIO no post (pedido do
 * Vinicius, 2026-08-23: nenhum post deve sair sem a marca da empresa) — se
 * a composição falhar (Storage fora do ar, arquivo corrompido etc.), a
 * geração falha inteira em vez de publicar uma imagem sem logo em
 * silêncio; quem chama vê o erro e o post não é criado.
 */
export async function generatePostImage(params: {
  apiKey: string
  imagePrompt: string
  logoUrl?: string | null
}): Promise<{ base64Image: string }> {
  const { base64Image } = await generateImage({ apiKey: params.apiKey, prompt: params.imagePrompt, size: '1024x1024', quality: 'medium' })
  if (!params.logoUrl) return { base64Image }
  return { base64Image: await compositeLogoOntoImage(base64Image, params.logoUrl) }
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
