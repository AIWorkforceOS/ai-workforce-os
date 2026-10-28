// Orquestra um post de CARROSSEL: roteiro (IA) → desenho dos slides (marca real) → upload no Storage. Não publica e não grava no banco:
// quem chama (planejador semanal / post avulso) grava a linha com as colunas retornadas e o post entra na mesma fila de aprovação.

import type { SupabaseClient } from '@supabase/supabase-js'
import { brandKitFrom } from '@/lib/brand-kit'
import { generateCarouselContent, uploadGeneratedImage, type RecentPostSummary } from './generator'
import { buildSlideSpecs, type CarouselContent, type StoredCarousel } from './carousel'
import { brandFrom, prepareLogo, renderSlides } from './carousel-render'
import { buildCombinedBusinessContext } from '@/lib/interview/engine'
import { applyBackgrounds, generateBackdropUrls, libraryPhotoUrls, wantsSlideBackgrounds } from './slide-backgrounds'
import { resolveContentLanguage } from './language'
import type { ContentInstruction } from './instructions'
import type { SocialPlatform } from './types'
import type { AgentConfig, Unit } from '@/lib/types'

/** Desenha e sobe os slides de um conteúdo (usado na geração e a cada edição). Logo cadastrado é obrigatório: se não baixar, falha. */
export async function renderAndStoreCarousel(params: {
  supabase: SupabaseClient
  unit: Pick<Unit, 'id' | 'name'>
  organizationProfile: Record<string, unknown> | null
  content: CarouselContent
  lang: 'pt' | 'en'
}): Promise<StoredCarousel> {
  const kit = brandKitFrom(params.organizationProfile)
  const logo = kit?.logo_url ? await prepareLogo(kit.logo_url) : null
  const brand = brandFrom({ name: params.unit.name, primary: kit?.primary_color, secondary: kit?.secondary_color, logo, lang: params.lang })
  const pngs = await renderSlides(buildSlideSpecs(params.content), brand)
  const slide_urls: string[] = []
  for (const png of pngs) {
    slide_urls.push(await uploadGeneratedImage({ supabase: params.supabase, unitId: params.unit.id, base64Image: png.toString('base64') }))
  }
  return { ...params.content, slide_urls, lang: params.lang }
}

export type CarouselPostDraft = {
  caption: string
  reasoning: string
  /** Capa do carrossel — vai em content_posts.image_url para as telas que já leem esse campo. */
  imageUrl: string
  fields: { format: 'carousel'; carousel: StoredCarousel }
  instructionFormatReason?: string
  instructionCta?: string
}

export async function createCarouselPostDraft(params: {
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
}): Promise<CarouselPostDraft> {
  const { supabase, ...rest } = params
  const generated = await generateCarouselContent(rest)
  // "Sempre com imagens de fundo" (instrução do dono): fotos reais da biblioteca primeiro; sem elas, fundos gerados por IA (custo registrado).
  let content = generated.content
  let backgrounds: 'library' | 'ai' | undefined
  if (wantsSlideBackgrounds(params.instruction ?? null)) {
    const photos = await libraryPhotoUrls(supabase, params.unit)
    if (photos.length > 0) {
      content = applyBackgrounds(content, photos)
      backgrounds = 'library'
    } else {
      const urls = await generateBackdropUrls({
        supabase,
        apiKey: params.apiKey,
        unitId: params.unit.id,
        companyContext: buildCombinedBusinessContext(params.organizationProfile, params.config.business_profile),
        objective: params.instruction?.objective ?? 'conteúdo institucional',
      })
      content = applyBackgrounds(content, urls)
      backgrounds = 'ai'
    }
  }
  // Mesmo critério de idioma do texto do post (generator.ts): pedido explícito da empresa > idioma da unidade > detectado da ficha.
  const explicit = (params.config.business_profile as Record<string, unknown> | null)?.idioma_conteudo
  const lang: 'pt' | 'en' =
    explicit === 'pt' || explicit === 'en' ? explicit : resolveContentLanguage(params.unit.default_conversation_language, [params.organizationProfile, params.config.business_profile])
  const stored = await renderAndStoreCarousel({ supabase, unit: params.unit, organizationProfile: params.organizationProfile, content, lang })
  return {
    caption: generated.caption,
    reasoning: generated.reasoning,
    imageUrl: stored.slide_urls[0]!,
    fields: { format: 'carousel', carousel: backgrounds ? { ...stored, backgrounds } : stored },
    instructionFormatReason: generated.instructionFormatReason,
    instructionCta: generated.instructionCta,
  }
}
