// Orquestra um post de VÍDEO: direção criativa → roteiro → vídeo generativo real 9:16 (Gemini Omni) → upload.
// O renderizador motion-design legado permanece apenas para editar posts antigos já gravados; conteúdo novo nunca cai silenciosamente em slideshow.

import type { SupabaseClient } from '@supabase/supabase-js'
import { brandKitFrom, compositeLogoOntoImage } from '@/lib/brand-kit'
import { countVideosThisMonth, videoRotationFrom, videoThemeFor } from './video-focus'
import { synthesizeNarration } from './video-audio'
import { generateVideoContent, type RecentPostSummary } from './generator'
import { brandFrom, prepareLogo } from './carousel-render'
import { resolveContentLanguage } from './language'
import { buildFrameSpecs, videoDuration, VIDEO_HEIGHT, VIDEO_WIDTH, type StoredVideo, type VideoContent } from './video'
import { composePoster, renderBackgrounds, renderOverlays } from './video-render'
import { encodeVideo } from './video-encode'
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
  const sceneStory = generated.content.scenes.map((scene, index) => `Cena ${index + 1}: ${scene.visual || scene.headline}`).join(' ')
  const videoPrompt = [
    'Create a premium, photorealistic vertical social media commercial in one continuous cinematic story.',
    `Business: ${generated.content.brand_name || params.unit.name}.`,
    generated.content.setting ? `Consistent world and people: ${generated.content.setting}.` : '',
    sceneStory,
    `Closing mood: ${generated.content.cta.visual || generated.content.cta.headline}.`,
    'Natural human motion, realistic physics, intentional camera movement, professional commercial lighting, coherent people and location throughout.',
    'No slideshow, no still-image montage, no embedded captions, no fake logos, no watermarks, no misspelled text. Keep uniforms and props unbranded.',
  ].filter(Boolean).join(' ')
  const realVideo = await generateGeminiVideo({ apiKey: geminiKey, prompt: videoPrompt })
  const mp4_url = await upload(supabase, params.unit.id, realVideo.bytes, 'mp4', realVideo.mimeType)
  const posterPrompt = `${videoPrompt} Create one polished key visual for the cover, with safe empty space for interface overlays. No text.`
  const poster = await generateGeminiImage({ apiKey: geminiKey, prompt: posterPrompt })
  const posterBase64 = kit?.logo_url ? await compositeLogoOntoImage(poster.base64, kit.logo_url) : poster.base64
  const poster_url = await upload(supabase, params.unit.id, Buffer.from(posterBase64, 'base64'), 'png', 'image/png')
  const stored: StoredVideo = {
    ...generated.content,
    mp4_url,
    poster_url,
    duration: realVideo.duration,
    lang,
    provider: 'gemini_omni',
    size_bytes: realVideo.bytes.byteLength,
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
