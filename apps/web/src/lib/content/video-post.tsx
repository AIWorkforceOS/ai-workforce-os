// Orquestra um post de VÍDEO: roteiro (IA) → quadros 9:16 (marca real) → MP4 (ffmpeg) → upload. Não publica e não grava no banco: quem chama
// grava a linha e o post entra na mesma fila de aprovação. Falha em qualquer etapa = erro claro e nenhum post criado.

import type { SupabaseClient } from '@supabase/supabase-js'
import { brandKitFrom } from '@/lib/brand-kit'
import { generateVideoContent, type RecentPostSummary } from './generator'
import { brandFrom, prepareLogo } from './carousel-render'
import { resolveContentLanguage } from './language'
import { buildFrameSpecs, videoDuration, VIDEO_HEIGHT, VIDEO_WIDTH, type StoredVideo, type VideoContent } from './video'
import { renderFrames } from './video-render'
import { encodeVideo } from './video-encode'
import type { ContentInstruction } from './instructions'
import type { SocialPlatform } from './types'
import type { AgentConfig, Unit } from '@/lib/types'

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
}): Promise<StoredVideo> {
  const kit = brandKitFrom(params.organizationProfile)
  const logo = kit?.logo_url ? await prepareLogo(kit.logo_url) : null
  const brand = brandFrom({ name: params.unit.name, primary: kit?.primary_color, secondary: kit?.secondary_color, logo, lang: params.lang })
  const specs = buildFrameSpecs(params.content)
  const frames = await renderFrames(specs, brand)
  const encoded = await encodeVideo({ frames, specs, width: VIDEO_WIDTH, height: VIDEO_HEIGHT })
  const mp4_url = await upload(params.supabase, params.unit.id, encoded.mp4, 'mp4', 'video/mp4')
  const poster_url = await upload(params.supabase, params.unit.id, frames[0]!, 'png', 'image/png')
  console.info(`[content/video] render ok: ${videoDuration(params.content)}s, ${encoded.bytes} bytes, ${encoded.durationMs} ms (ffmpeg local, sem custo externo)`)
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
  const generated = await generateVideoContent(rest)
  const explicit = (params.config.business_profile as Record<string, unknown> | null)?.idioma_conteudo
  const lang: 'pt' | 'en' =
    explicit === 'pt' || explicit === 'en' ? explicit : resolveContentLanguage(params.unit.default_conversation_language, [params.organizationProfile, params.config.business_profile])
  const stored = await renderAndStoreVideo({ supabase, unit: params.unit, organizationProfile: params.organizationProfile, content: generated.content, lang })
  return {
    caption: generated.caption,
    reasoning: generated.reasoning,
    imageUrl: stored.poster_url,
    fields: { format: 'video', video: stored },
    instructionFormatReason: generated.instructionFormatReason,
    instructionCta: generated.instructionCta,
  }
}
