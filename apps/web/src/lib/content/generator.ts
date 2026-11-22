// Geração de conteúdo (legenda + imagem) do funcionário Conteúdo/Social,
// usando a mesma OPENAI_API_KEY já configurada no projeto
// (lib/openai.ts). Legenda via chat (JSON mode); imagem via gpt-image-2.

import type { SupabaseClient } from '@supabase/supabase-js'
import { generateImage, generateStructuredReply } from '@/lib/openai'
import { buildCombinedBusinessContext } from '@/lib/interview/engine'
import { brandKitFrom, compositeLogoOntoImage, type BrandKit } from '@/lib/brand-kit'
import { resolveContentLanguage } from './language'
import { buildInstructionPromptBlock, type ContentInstruction } from './instructions'
import { composeCaption, normalizeCarousel, type CarouselContent } from './carousel'
import { normalizeVideo, type VideoContent } from './video'
import type { AgentConfig, Unit } from '@/lib/types'
import type { SocialPlatform } from './types'
import { creativeDirectionBlock, directCreative } from './creative-director'
import { generateGeminiImage, getGeminiApiKey } from './gemini-media'
import { assessCreativeImage, assessCreativeText, qualityFeedback } from './quality-control'

export type { BrandKit }

type CaptionOutput = { caption?: string; image_prompt?: string; reasoning?: string; instruction_format_reason?: string; instruction_cta?: string }

export type GeneratedPostContent = {
  caption: string
  imagePrompt: string
  reasoning: string
  /** Só quando uma instrução operacional estava ativa: por que este formato serve ao objetivo e a CTA usada (prova de "Instrução aplicada"). */
  instructionFormatReason?: string
  instructionCta?: string
}

/** Resumo de um post recente, usado só pra dar contexto ao gerador (evitar repetição) — ver buildRecentPostsContext. */
export type RecentPostSummary = { pillar: string | null; caption: string; imagePrompt: string | null }

async function directionFor(params: {
  apiKey: string
  config: AgentConfig
  unit: Unit
  organizationProfile: Record<string, unknown> | null
  platform: SocialPlatform
  format: 'image' | 'carousel' | 'video'
  objective: string
  recentPosts?: RecentPostSummary[]
}): Promise<string> {
  const companyContext = buildCombinedBusinessContext(params.organizationProfile, params.config.business_profile) || `Empresa ${params.unit.name}`
  const kit = brandKitFrom(params.organizationProfile)
  const profile = params.config.business_profile as Record<string, unknown> | null
  const brandContext = [
    kit?.primary_color ? `cor primária ${kit.primary_color}` : '',
    kit?.secondary_color ? `cor secundária ${kit.secondary_color}` : '',
    kit?.font_family ? `fontes ${kit.font_family}` : '',
    kit?.visual_style ? `estilo ${kit.visual_style}` : '',
    kit?.brand_voice ? `voz ${kit.brand_voice}` : '',
    kit?.content_goals ? `objetivos ${kit.content_goals}` : '',
    kit?.target_audience ? `público ${kit.target_audience}` : '',
    kit?.approved_offers ? `ofertas permitidas ${kit.approved_offers}` : '',
    kit?.forbidden_content ? `proibições ${kit.forbidden_content}` : '',
    Array.isArray(profile?.before_after_pairs) && profile.before_after_pairs.length > 0 ? `${profile.before_after_pairs.length} pares reais de antes/depois disponíveis; use somente pares completos` : '',
  ].filter(Boolean).join('; ') || 'identidade ainda incompleta; mantenha visual sóbrio e verdadeiro'
  const recentContext = (params.recentPosts ?? []).slice(0, 6).map((post) => post.caption.slice(0, 180)).join(' | ')
  const direction = await directCreative({
    apiKey: params.apiKey,
    companyContext,
    platform: params.platform,
    format: params.format,
    objective: params.objective,
    brandContext,
    recentContext,
  })
  return creativeDirectionBlock(direction)
}

const RECENT_POSTS_FOR_CONTEXT = 6
// Achado real (2026-08-28, conta AlizoAi): 100 chars só mostrava a
// primeira frase de cada legenda — o suficiente pra existir contexto, mas
// pouco pra o modelo perceber que o ARGUMENTO inteiro (não só a frase de
// abertura) já tinha sido usado 2 posts atrás. Subido pra caber a ideia
// completa de cada post recente.
const RECENT_TEXT_TRUNCATE = 220

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
  return [
    `POSTS RECENTES DESTA CONTA (mais novo primeiro): ${items.join(' / ')}.`,
    // Achado real (2026-08-28, conta AlizoAi): "não repita o mesmo tema"
    // não bastou — o modelo trocava só o pilar/rótulo e mantinha o MESMO
    // argumento ("ineficiência é o problema, funcionário digital 24/7 é a
    // solução, chama no link da bio") reescrito com sinônimos, 3 posts
    // seguidos. Trocar de pilar não conta como variar de verdade.
    'REGRA DURA: o post de agora precisa argumentar uma coisa DIFERENTE dos posts acima, não só usar palavras diferentes pra dizer a mesma coisa — se os recentes já disseram "ineficiência é o problema, nós resolvemos, fale com a gente", este post NÃO pode repetir essa mesma lógica de novo, mesmo com um pilar diferente. Escolha um ângulo concreto que ainda não foi usado (ex.: um fato/dado específico, uma mini-história ou cenário, uma pergunta provocativa, um mito comum sendo desmentido, um "como funciona" passo a passo, uma comparação antes/depois, uma curiosidade, um bastidor da equipe) e uma estrutura de texto diferente da dos posts recentes (não repita "você sabia que" / "descubra como" se um post recente já abriu assim).',
  ].join(' ')
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
  /**
   * Formato visual OBRIGATÓRIO da imagem deste post — decidido em código por
   * pickNextVisualAngle (lib/content/planner.ts), não pelo modelo. Achado
   * real (2026-08-28, conta AlizoAi): pedir "varie o formato" por texto
   * livre não funcionou (mesma classe de bug do pickNextPillar antigo) — o
   * modelo continuava caindo no mesmo clichê visual. Agora o ângulo já vem
   * escolhido e só é imposto, igual pillar/platform.
   */
  visualAngle: string
  /** Instrução operacional ativa no dia do post (lib/content/instructions.ts). Ausente = prompt idêntico ao de antes. */
  instruction?: ContentInstruction | null
  /** Gera o roteiro de um CARROSSEL (capa + slides + CTA) em vez de um post de imagem única. */
  carousel?: boolean
  /** Gera o roteiro de um VÍDEO curto vertical (cenas + CTA). */
  video?: boolean
  /** Tema obrigatório do vídeo (rotação mensal da ficha, ex. "manutenção" ou "limpeza"). */
  videoTheme?: string | null
}): string {
  const { config, unit, organizationProfile, platform, pillar, holiday, recentPosts, attachmentsContext, visualAngle, instruction, carousel, video, videoTheme } = params
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
  const nameInVideos = typeof (config.business_profile as Record<string, unknown> | null)?.nome_nos_videos === 'string' ? String((config.business_profile as Record<string, unknown>).nome_nos_videos).trim().slice(0, 80) : ''
  const recentPostsContext = buildRecentPostsContext(recentPosts)

  return [
    `Você é ${config.persona_name}, gestor(a) de conteúdo e redes sociais digital da unidade ${unit.name}.`,
    `Sua tarefa agora: criar UM ${video ? 'VÍDEO CURTO VERTICAL (Reels)' : carousel ? 'CARROSSEL' : 'post'} orgânico para o ${platformLabel(platform)}${pillar && !(video && videoTheme) ? `, sobre o pilar de conteúdo "${pillar}"` : ''}.`,
    businessContext ??
      'Ainda não há uma ficha de negócio detalhada — escreva algo genérico, seguro e verdadeiro para uma empresa de serviços, sem inventar detalhes específicos.',
    'Aja como um gestor de conteúdo de verdade, não como quem posta por postar: antes de escrever, decida qual ângulo/formato (dica prática, resultado real com problema→solução, bastidores da equipe, prova social, pergunta pro público, educativo, autoridade no assunto etc.) tem mais chance de gerar resultado de negócio de verdade — leads qualificados, confiança, autoridade — para ESTE pilar e para o público-alvo descrito na ficha. Nunca gere um post genérico só para preencher a grade de publicação.',
    // Achado real (2026-08-28, conta AlizoAi): pedir por texto "varie o
    // formato visual" (2 tentativas) não bastou — o modelo continuava
    // caindo no mesmo clichê (robôs + telas de dashboard + azul/turquesa)
    // post após post, mesmo com a instrução reforçada. O ângulo agora é
    // DECIDIDO em código (pickNextVisualAngle, mesmo princípio do fix de
    // pickNextPillar) e só imposto aqui — não é mais escolha livre do modelo.
    video
      ? 'VÍDEO CURTO VERTICAL 9:16, com movimento real, áudio nativo e NARRAÇÃO, criado como um comercial cinematográfico contínuo de 15 segundos — nunca slideshow, montagem de fotografias ou lista de dicas. A cena inicial precisa prender atenção nos primeiros 2 segundos; as seguintes desenvolvem UMA história contínua e terminam com uma chamada para ação. Defina personagens, ambiente, figurino, iluminação e movimento de câmera estritamente a partir da ficha DESTA empresa e da direção criativa aprovada. Não presuma técnicos, uniformes, prédios, clínicas, escritórios ou qualquer segmento. O campo "setting" descreve em inglês o mundo visual coerente; cada "visual" descreve ação e movimento reais, câmera, luz e continuidade. Nunca peça texto, logo, placa ou marca dentro da cena. Use somente fatos comprovados na ficha; nunca invente clientes, depoimentos, preços, resultados, números ou garantias.'
      : carousel
      ? 'CARROSSEL: capa com gancho forte (título curto), 3 a 6 slides de conteúdo (cada um com UMA ideia: título curto + 1-2 frases), e um slide final de chamada para ação. Texto enxuto, que se lê no celular. Use SOMENTE fatos que estão na ficha da empresa — nunca invente clientes, depoimentos, resultados, números, fotos ou garantias; se faltar dado, fale do método/serviço de forma verdadeira e genérica. Não cite canais de contato (telefone, WhatsApp, e-mail, site, endereço) que não estejam na ficha da empresa: na chamada para ação use só um convite genérico (o equivalente a “entre em contato”) ou o canal que consta na ficha — SEMPRE no idioma da legenda.'
      : `FORMATO VISUAL OBRIGATÓRIO deste post (não é sugestão — não use nenhum outro formato): ${visualAngle}. O image_prompt tem que descrever a cena seguindo EXATAMENTE esse formato.`,
    recentPostsContext,
    attachmentsContext || null,
    instruction ? buildInstructionPromptBlock(instruction) : null,
    video && videoTheme
      ? `TEMA OBRIGATÓRIO deste vídeo (definido pelo dono): ${videoTheme}. Toda a história e a chamada para ação devem tratar desse tema para o público específico descrito na ficha desta empresa.${nameInVideos ? ` Sempre que citar o nome da empresa, use exatamente “${nameInVideos}”.` : ''}`
      : null,
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
    video
      ? '{"script": "narração falada do vídeo, texto corrido na ordem das cenas", "setting": "cenário comum das fotos, em inglês", "scenes": [{"headline": "até 8 palavras", "text": "1 frase de apoio", "seconds": 4, "visual": "descrição em inglês da fotografia desta cena: quem, fazendo o quê, onde, luz"}], "cta_title": "chamada curta", "cta_body": "1 frase dizendo como falar com a empresa", "cta_seconds": 4, "cta_visual": "descrição em inglês da fotografia do fechamento", "caption": "legenda do post com call to action", "hashtags": ["5 a 8 hashtags relevantes, sem #"], "reasoning": "1 frase curta, em português, explicando por que este vídeo faz sentido agora, para o dono da empresa entender"} — todos os textos das cenas e a legenda no idioma da legenda indicado acima.'
      : carousel
      ? '{"template_family": "uma das famílias aprovadas pela direção criativa", "cover_title": "gancho curto da capa", "cover_subtitle": "1 frase de apoio", "slides": [{"title": "título curto", "body": "1-2 frases"}], "cta_title": "chamada curta", "cta_body": "1 frase dizendo como falar com a empresa", "caption": "legenda do post com call to action", "hashtags": ["5 a 8 hashtags relevantes, sem #"], "reasoning": "1 frase curta, em português, explicando por que este carrossel faz sentido agora, para o dono da empresa entender"} — todos os textos dos slides e a legenda no idioma da legenda indicado acima.'
      : '{"caption": "a legenda pronta para publicar, incluindo call to action se fizer sentido para a empresa", "image_prompt": "descrição em inglês, detalhada e visual, para gerar a imagem que acompanha o post — sem nenhum texto/letra embutido na imagem", "reasoning": "1 frase curta, em português, explicando por que este post faz sentido agora, para o dono da empresa entender"}',
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
  visualAngle: string
  instruction?: ContentInstruction | null
}): Promise<GeneratedPostContent> {
  const direction = await directionFor({ ...params, format: 'image', objective: params.instruction?.objective || params.pillar || 'crescimento da marca' })
  const systemPrompt = `${buildCaptionSystemPrompt(params)} ${direction}`
  let output = await generateStructuredReply<CaptionOutput>({
    apiKey: params.apiKey,
    systemPrompt,
    history: [{ role: 'user', content: 'Gere o post agora.' }],
    maxTokens: params.instruction ? 700 : 500,
    temperature: 0.8,
  })
  const companyContext = buildCombinedBusinessContext(params.organizationProfile, params.config.business_profile) || params.unit.name
  const assessment = await assessCreativeText({ apiKey: params.apiKey, format: 'post de imagem', companyContext, creative: output })
  if (!assessment.pass) {
    output = await generateStructuredReply<CaptionOutput>({
      apiKey: params.apiKey,
      systemPrompt,
      history: [{ role: 'user', content: `Refaça o post agora. ${qualityFeedback(assessment)}` }],
      maxTokens: params.instruction ? 700 : 500,
      temperature: 0.7,
    })
  }

  const caption = (output.caption ?? '').trim()
  const imagePrompt = (output.image_prompt ?? '').trim()
  const reasoning = (output.reasoning ?? '').trim()
  if (!caption || !imagePrompt) {
    throw new Error('OpenAI não retornou legenda ou prompt de imagem válidos para o post.')
  }
  const base = { caption, imagePrompt, reasoning: reasoning || 'Post gerado conforme a frequência configurada pela empresa.' }
  if (!params.instruction) return base
  return {
    ...base,
    instructionFormatReason: (output.instruction_format_reason ?? '').trim() || undefined,
    instructionCta: (output.instruction_cta ?? '').trim() || undefined,
  }
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
  const geminiKey = getGeminiApiKey()
  const useGemini = (process.env.CONTENT_IMAGE_PROVIDER || '').toLowerCase() === 'gemini' && geminiKey
  let base64Image = useGemini
    ? (await generateGeminiImage({ apiKey: geminiKey, prompt: params.imagePrompt })).base64
    : (await generateImage({ apiKey: params.apiKey, prompt: params.imagePrompt, size: '1024x1024', quality: 'medium' })).base64Image
  const visualAssessment = await assessCreativeImage({ apiKey: params.apiKey, imageBase64: base64Image, expected: params.imagePrompt })
  if (!visualAssessment.pass) {
    const correctedPrompt = `${params.imagePrompt}. ${qualityFeedback(visualAssessment)}. Produce a completely new professional composition.`
    base64Image = useGemini
      ? (await generateGeminiImage({ apiKey: geminiKey, prompt: correctedPrompt })).base64
      : (await generateImage({ apiKey: params.apiKey, prompt: correctedPrompt, size: '1024x1024', quality: 'high' })).base64Image
  }
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

export type GeneratedCarousel = {
  content: CarouselContent
  /** Legenda pronta para publicar (texto + hashtags). */
  caption: string
  reasoning: string
  instructionFormatReason?: string
  instructionCta?: string
}

type CarouselOutput = Record<string, unknown> & { caption?: string; reasoning?: string; hashtags?: unknown }

/** Roteiro de um carrossel (capa, slides, CTA, legenda, hashtags) via chat em JSON mode. Só texto: o desenho dos slides é do carousel-render. */
export async function generateCarouselContent(params: {
  apiKey: string
  config: AgentConfig
  unit: Unit
  organizationProfile: Record<string, unknown> | null
  platform: SocialPlatform
  pillar: string | null
  holiday?: string | null
  recentPosts?: RecentPostSummary[]
  attachmentsContext?: string | null
  instruction?: ContentInstruction | null
}): Promise<GeneratedCarousel> {
  const direction = await directionFor({ ...params, format: 'carousel', objective: params.instruction?.objective || params.pillar || 'crescimento da marca' })
  const systemPrompt = `${buildCaptionSystemPrompt({ ...params, visualAngle: '', carousel: true })} ${direction}`
  let output = await generateStructuredReply<CarouselOutput>({
    apiKey: params.apiKey,
    systemPrompt,
    history: [{ role: 'user', content: 'Gere o carrossel agora.' }],
    maxTokens: 1500,
    temperature: 0.8,
  })
  const companyContext = buildCombinedBusinessContext(params.organizationProfile, params.config.business_profile) || params.unit.name
  const assessment = await assessCreativeText({ apiKey: params.apiKey, format: 'carrossel', companyContext, creative: output })
  if (!assessment.pass) {
    output = await generateStructuredReply<CarouselOutput>({
      apiKey: params.apiKey,
      systemPrompt,
      history: [{ role: 'user', content: `Refaça o carrossel. ${qualityFeedback(assessment)}` }],
      maxTokens: 1500,
      temperature: 0.7,
    })
  }
  const normalized = normalizeCarousel(output)
  if (!normalized.ok) throw new Error(`A IA devolveu um carrossel inválido: ${normalized.error}`)
  const caption = (output.caption ?? '').trim()
  if (!caption) throw new Error('A IA não devolveu a legenda do carrossel.')
  const reasoning = (output.reasoning ?? '').trim()
  const extra = params.instruction
    ? {
        instructionFormatReason: String(output.instruction_format_reason ?? '').trim() || undefined,
        instructionCta: String(output.instruction_cta ?? '').trim() || undefined,
      }
    : {}
  return {
    content: normalized.value,
    caption: composeCaption(caption, normalized.value.hashtags),
    reasoning: reasoning || 'Carrossel gerado conforme a frequência configurada pela empresa.',
    ...extra,
  }
}

export type GeneratedVideo = {
  content: VideoContent
  caption: string
  reasoning: string
  instructionFormatReason?: string
  instructionCta?: string
}

/** Roteiro de um vídeo curto (cenas, CTA, legenda, hashtags) via chat em JSON mode. Só texto: quadros e MP4 são do video-render/video-encode. */
export async function generateVideoContent(params: {
  apiKey: string
  config: AgentConfig
  unit: Unit
  organizationProfile: Record<string, unknown> | null
  platform: SocialPlatform
  pillar: string | null
  holiday?: string | null
  recentPosts?: RecentPostSummary[]
  attachmentsContext?: string | null
  instruction?: ContentInstruction | null
  videoTheme?: string | null
}): Promise<GeneratedVideo> {
  const direction = await directionFor({ ...params, format: 'video', objective: params.instruction?.objective || params.videoTheme || params.pillar || 'crescimento da marca' })
  const systemPrompt = `${buildCaptionSystemPrompt({ ...params, visualAngle: '', video: true })} ${direction}`
  let output = await generateStructuredReply<CarouselOutput>({
    apiKey: params.apiKey,
    systemPrompt,
    history: [{ role: 'user', content: 'Gere o vídeo agora.' }],
    maxTokens: 1800,
    temperature: 0.8,
  })
  const companyContext = buildCombinedBusinessContext(params.organizationProfile, params.config.business_profile) || params.unit.name
  const assessment = await assessCreativeText({ apiKey: params.apiKey, format: 'vídeo', companyContext, creative: output })
  if (!assessment.pass) {
    output = await generateStructuredReply<CarouselOutput>({
      apiKey: params.apiKey,
      systemPrompt,
      history: [{ role: 'user', content: `Refaça o roteiro do vídeo. ${qualityFeedback(assessment)}` }],
      maxTokens: 1800,
      temperature: 0.7,
    })
  }
  const normalized = normalizeVideo(output)
  if (!normalized.ok) throw new Error(`A IA devolveu um vídeo inválido: ${normalized.error}`)
  const caption = (output.caption ?? '').trim()
  if (!caption) throw new Error('A IA não devolveu a legenda do vídeo.')
  const reasoning = (output.reasoning ?? '').trim()
  const extra = params.instruction
    ? {
        instructionFormatReason: String(output.instruction_format_reason ?? '').trim() || undefined,
        instructionCta: String(output.instruction_cta ?? '').trim() || undefined,
      }
    : {}
  return {
    content: normalized.value,
    caption: composeCaption(caption, normalized.value.hashtags),
    reasoning: reasoning || 'Vídeo gerado conforme a frequência configurada pela empresa.',
    ...extra,
  }
}
