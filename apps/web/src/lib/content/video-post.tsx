// Orquestra um post de VÍDEO: direção criativa → roteiro → vídeo generativo real 9:16 (Gemini Omni) → upload.
// O renderizador motion-design legado permanece apenas para editar posts antigos já gravados; conteúdo novo nunca cai silenciosamente em slideshow.

import type { SupabaseClient } from '@supabase/supabase-js'
import sharp from 'sharp'
import { brandKitFrom, compositeLogoOntoImage } from '@/lib/brand-kit'
import { countVideosThisMonth, videoRotationFrom, videoThemeFor } from './video-focus'
import { synthesizeNarration } from './video-audio'
import { generateVideoContent, type RecentPostSummary } from './generator'
import { brandFrom, prepareLogo } from './carousel-render'
import { resolveContentLanguage } from './language'
import { buildFrameSpecs, videoDuration, VIDEO_HEIGHT, VIDEO_WIDTH, type StoredVideo, type VideoContent } from './video'
import { composePoster, renderBackgrounds, renderOverlays } from './video-render'
import { applyVideoBranding, encodeVideo, prepareTransparentVideoLogo } from './video-encode'
import type { ContentInstruction } from './instructions'
import type { SocialPlatform } from './types'
import type { AgentConfig, Unit } from '@/lib/types'
import { assertVideoQuota } from './media-policy'
import { generateGeminiImage, generateGeminiVideo, getGeminiApiKey } from './gemini-media'

async function upload(supabase: SupabaseClient, unitId: string, bytes: Buffer, ext: 'mp4' | 'png', contentType: string): Promise<string> {
  const path = `${unitId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const { error } = await supabase.storage.from('content-media').upload(path, bytes, { contentType, upsert: false })
  if (error) throw new Error(`Falha ao subir o ${ext === 'mp4' ? 'vídeo' : 'quadro de capa'}: ${error.message}`)
  return supabase.storage.from('content-media').getPublicUrl(path).data.publicUrl
}

function xml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&apos;', '"': '&quot;' })[character]!)
}

/** Capa local de contingência: uma falha isolada da imagem não descarta um vídeo já gerado. */
export async function createFallbackVideoPoster(params: { brandName: string; primary?: string | null; secondary?: string | null }): Promise<Buffer> {
  const primary = /^#[0-9a-f]{6}$/i.test(params.primary ?? '') ? params.primary! : '#0f172a'
  const secondary = /^#[0-9a-f]{6}$/i.test(params.secondary ?? '') ? params.secondary! : '#06b6d4'
  const name = xml(params.brandName.trim().slice(0, 70) || 'Conteúdo profissional')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350">
    <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${primary}"/><stop offset="1" stop-color="${secondary}"/></linearGradient></defs>
    <rect width="1080" height="1350" fill="url(#bg)"/><circle cx="920" cy="170" r="300" fill="#fff" opacity=".08"/>
    <circle cx="120" cy="1190" r="360" fill="#fff" opacity=".06"/><rect x="100" y="106" width="92" height="10" rx="5" fill="#fff" opacity=".9"/>
    <text x="100" y="640" fill="#fff" font-family="Arial, sans-serif" font-size="76" font-weight="700">${name}</text>
    <text x="100" y="720" fill="#fff" opacity=".82" font-family="Arial, sans-serif" font-size="34">Vídeo profissional</text>
  </svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}

/** Desenha, codifica e sobe o vídeo (usado na geração e a cada edição). Logo cadastrado é obrigatório: se não baixar, falha. */
export async function renderAndStoreVideo(params: {
  supabase: SupabaseClient
  unit: Pick<Unit, 'id' | 'name'>
  organizationProfile: Record<string, unknown> | null
  content: VideoContent
  lang: 'pt' | 'en'
  /** Com a chave, o roteiro vira narração em voz; sem ela (ou se falhar) o vídeo leva só a trilha de fundo. */
  apiKey?: string | null
}): Promise<StoredVideo> {
  const kit = brandKitFrom(params.organizationProfile)
  const logo = kit?.logo_url ? await prepareLogo(kit.logo_url) : null
  const brand = brandFrom({ name: params.content.brand_name || params.unit.name, primary: kit?.primary_color, secondary: kit?.secondary_color, logo, lang: params.lang })
  const specs = buildFrameSpecs(params.content)
  const overlays = await renderOverlays(specs, brand)
  const { buffers: backgrounds, failed } = await renderBackgrounds(specs, brand)
  if (failed > 0) console.warn(`[content/video] ${failed} imagem(ns) de fundo não baixaram; essas cenas saíram com a cor da marca`)
  const narration = params.apiKey && params.content.script ? await synthesizeNarration({ apiKey: params.apiKey, text: params.content.script }) : null
  const encoded = await encodeVideo({ backgrounds, overlays, specs, width: VIDEO_WIDTH, height: VIDEO_HEIGHT, narration })
  const mp4_url = await upload(params.supabase, params.unit.id, encoded.mp4, 'mp4', 'video/mp4')
  const poster_url = await upload(params.supabase, params.unit.id, await composePoster(backgrounds[0]!, overlays[0]!), 'png', 'image/png')
  console.info(`[content/video] render ok: ${videoDuration(params.content)}s, ${encoded.bytes} bytes, ${encoded.durationMs} ms (ffmpeg local)`)
  return { ...params.content, mp4_url, poster_url, duration: videoDuration(params.content), lang: params.lang, render_ms: encoded.durationMs, size_bytes: encoded.bytes }
}

export type VideoPostDraft = {
  caption: string
  reasoning: string
  /** Capa do vídeo (primeiro quadro) — vai em content_posts.image_url para as telas que já leem esse campo. */
  imageUrl: string
  fields: { format: 'video'; video: StoredVideo }
  instructionFormatReason?: string
  instructionCta?: string
}

export function buildProfessionalVideoPrompt(params: {
  brandName: string
  primary: string
  secondary: string
  visualStyle?: string | null
  setting?: string | null
  sceneStory: string
  closingMood: string
  recentPosts?: RecentPostSummary[]
}): string {
  const recent = (params.recentPosts ?? []).slice(0, 4).map((post) => post.caption.slice(0, 140)).filter(Boolean)
  return [
    'Create a premium, photorealistic vertical social media commercial in one continuous cinematic story.',
    `Business: ${params.brandName}.`,
    `MANDATORY brand palette: primary ${params.primary} and secondary ${params.secondary}. Use these colors visibly and tastefully in wardrobe accents, props, lighting accents, or set dressing. Do not replace them with another dominant palette.`,
    params.visualStyle ? `Mandatory visual style: ${params.visualStyle}.` : '',
    params.setting ? `Consistent world and people: ${params.setting}.` : '',
    params.sceneStory,
    `Closing mood: ${params.closingMood}.`,
    recent.length ? `Recent pieces to avoid repeating: ${recent.join(' | ')}. This video must use a clearly different opening shot, location composition, camera movement, action and narrative progression.` : '',
    'Natural human motion, realistic physics, intentional camera movement, professional commercial lighting, coherent people and location throughout.',
    'Every uniform, vehicle, tool, wall, sign and prop must be completely plain and unbranded: no letters, numbers, symbols, pseudo-logos, badges or invented markings. Never attempt to draw the business logo on clothing or inside the scene.',
    'No slideshow, no still-image montage, no embedded captions, no generated logos, no watermarks and no misspelled text. Leave the final 2.5 seconds visually calm, with no important action, face or text: the Alizo system replaces that interval with the exact official transparent logo and a complete branded ending.',
  ].filter(Boolean).join(' ')
}

export async function createVideoPostDraft(params: {
  supabase: SupabaseClient
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
}): Promise<VideoPostDraft> {
  const { supabase, ...rest } = params
  await assertVideoQuota({ supabase, unitId: params.unit.id, profile: params.config.business_profile as Record<string, unknown> | null })
  const geminiKey = getGeminiApiKey()
  if (!geminiKey) {
    throw new Error('Vídeo profissional indisponível: GEMINI_API_KEY ainda não foi configurada. O sistema não criará apresentação de imagens como substituto.')
  }
  // Tema do vídeo pela rotação da ficha (ex.: 3 de manutenção e 1 de limpeza por mês); sem rotação, o vídeo é livre como antes.
  const rotation = videoRotationFrom(params.config.business_profile as Record<string, unknown> | null)
  const videoTheme = rotation.length > 0 ? videoThemeFor(rotation, await countVideosThisMonth(supabase, params.unit.id, params.unit.timezone || 'America/Phoenix')) : null
  const generated = await generateVideoContent({ ...rest, videoTheme })
  const nameInVideos = (params.config.business_profile as Record<string, unknown> | null)?.nome_nos_videos
  if (typeof nameInVideos === 'string' && nameInVideos.trim()) generated.content.brand_name = nameInVideos.trim().slice(0, 80)
  const explicit = (params.config.business_profile as Record<string, unknown> | null)?.idioma_conteudo
  const lang: 'pt' | 'en' =
    explicit === 'pt' || explicit === 'en' ? explicit : resolveContentLanguage(params.unit.default_conversation_language, [params.organizationProfile, params.config.business_profile])
  const kit = brandKitFrom(params.organizationProfile)
  if (!kit?.logo_url || !kit.primary_color || !kit.secondary_color) {
    throw new Error('Complete a identidade visual com logo, cor principal e cor secundária antes de gerar vídeos. Nenhum crédito foi utilizado.')
  }
  const logoResponse = await fetch(kit.logo_url, { signal: AbortSignal.timeout(15_000) })
  if (!logoResponse.ok) throw new Error(`A logo oficial não pôde ser carregada (status ${logoResponse.status}). Nenhum crédito foi utilizado.`)
  // Valida o arquivo antes da chamada paga. O compositor valida novamente,
  // mas esta etapa evita gastar um vídeo quando a marca ainda tem fundo.
  const logoBytes = await prepareTransparentVideoLogo(Buffer.from(await logoResponse.arrayBuffer()))
  const sceneStory = generated.content.scenes.map((scene, index) => `Cena ${index + 1}: ${scene.visual || scene.headline}`).join(' ')
  const videoPrompt = buildProfessionalVideoPrompt({
    brandName: generated.content.brand_name || params.unit.name,
    primary: kit.primary_color,
    secondary: kit.secondary_color,
    visualStyle: kit.visual_style,
    setting: generated.content.setting,
    sceneStory,
    closingMood: generated.content.cta.visual || generated.content.cta.headline,
    recentPosts: params.recentPosts,
  })
  const realVideo = await generateGeminiVideo({ apiKey: geminiKey, prompt: videoPrompt })
  const brandedVideo = await applyVideoBranding({ mp4: realVideo.bytes, logo: logoBytes, primary: kit.primary_color, secondary: kit.secondary_color })
  const mp4_url = await upload(supabase, params.unit.id, brandedVideo, 'mp4', realVideo.mimeType)
  const posterPrompt = `${videoPrompt} Create one polished key visual for the cover, with safe empty space for interface overlays. No text.`
  let posterBytes: Buffer
  try {
    const poster = await generateGeminiImage({ apiKey: geminiKey, prompt: posterPrompt })
    const posterBase64 = kit?.logo_url ? await compositeLogoOntoImage(poster.base64, kit.logo_url) : poster.base64
    posterBytes = Buffer.from(posterBase64, 'base64')
  } catch (error) {
    console.error('[content/video] capa Gemini falhou; usando capa local sem descartar o vídeo', {
      unitId: params.unit.id,
      error: error instanceof Error ? error.message : String(error),
    })
    posterBytes = await createFallbackVideoPoster({
      brandName: generated.content.brand_name || params.unit.name,
      primary: kit?.primary_color,
      secondary: kit?.secondary_color,
    })
  }
  const poster_url = await upload(supabase, params.unit.id, posterBytes, 'png', 'image/png')
  const stored: StoredVideo = {
    ...generated.content,
    mp4_url,
    poster_url,
    duration: realVideo.duration,
    lang,
    provider: 'gemini_omni',
    size_bytes: brandedVideo.byteLength,
    images_generated: 1,
  }
  return {
    caption: generated.caption,
    reasoning: generated.reasoning,
    imageUrl: stored.poster_url,
    fields: { format: 'video', video: stored },
    instructionFormatReason: generated.instructionFormatReason,
    instructionCta: generated.instructionCta,
  }
}
