import { NextResponse } from 'next/server'
import { getAppUser } from '@/lib/app-user'
import { createServiceClient } from '@/lib/supabase/service'
import { fetchOrganizationBusinessProfile } from '@/lib/organizations'
import { resolveSocialConfig, publishFacebookCarousel, publishFacebookVideo, publishInstagramCarousel, publishInstagramReel } from '@/lib/content/meta-content'
import { renderAndStoreCarousel } from '@/lib/content/carousel-post'
import { renderAndStoreVideo } from '@/lib/content/video-post'
import { TEST_CAPTION, TEST_CAROUSEL, TEST_VIDEO, checkTestPublishRequest } from '@/lib/content/test-publish'
import type { SocialAccount } from '@/lib/content/types'
import type { Unit } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

type Step = { step: string; ok: boolean; ms: number; detail?: string }

/**
 * Teste REAL de publicação de carrossel e vídeo, só em página de teste da Meta. Super admin; o nome da página precisa conter "teste/test/sandbox" e ser
 * digitado de novo como confirmação. Usa conteúdo fixo marcado como teste (sem IA, sem custo), NÃO cria post no banco e ignora as travas
 * CONTENT_*_PUBLISH (é justamente para validar o fluxo antes de ligá-las). Devolve cada etapa com tempo e erro, para diagnóstico.
 *
 * POST { social_account_id, kind: 'carousel' | 'video', confirm }
 */
export async function POST(request: Request) {
  const actor = await getAppUser()
  if (!actor) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  const body = (await request.json().catch(() => null)) as { social_account_id?: string; kind?: string; confirm?: unknown } | null
  if (!body?.social_account_id || (body.kind !== 'carousel' && body.kind !== 'video')) return NextResponse.json({ error: 'Envie social_account_id e kind (carousel ou video).' }, { status: 400 })

  const service = createServiceClient()
  if (!service) return NextResponse.json({ error: 'Serviço não configurado (service role).' }, { status: 500 })
  const { data: row } = await service.from('social_accounts').select('*').eq('id', body.social_account_id).maybeSingle()
  const account = row as SocialAccount | null
  if (!account) return NextResponse.json({ error: 'Conta não encontrada.' }, { status: 404 })

  const check = checkTestPublishRequest({ pageName: account.page_name, confirm: body.confirm, isSuperAdmin: actor.isSuperAdmin })
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 403 })

  const steps: Step[] = []
  const run = async <T,>(step: string, fn: () => Promise<T>): Promise<T | null> => {
    const started = Date.now()
    try {
      const value = await fn()
      steps.push({ step, ok: true, ms: Date.now() - started })
      return value
    } catch (error) {
      steps.push({ step, ok: false, ms: Date.now() - started, detail: error instanceof Error ? error.message : String(error) })
      return null
    }
  }

  const { data: unit } = await service.from('units').select('*').eq('id', account.unit_id).maybeSingle()
  if (!unit) return NextResponse.json({ error: 'Unidade da conta não encontrada.' }, { status: 404 })
  const config = await run('credencial da Página', () => resolveSocialConfig(account))
  if (!config) return NextResponse.json({ ok: false, steps }, { status: 502 })
  const orgProfile = await fetchOrganizationBusinessProfile(service, (unit as Unit).org_id ?? '')
  const ig = account.instagram_business_account_id
  const results: { platform: string; externalPostId: string }[] = []

  if (body.kind === 'carousel') {
    const stored = await run('desenhar e subir os slides', () => renderAndStoreCarousel({ supabase: service, unit: unit as Unit, organizationProfile: orgProfile, content: TEST_CAROUSEL, lang: 'pt' }))
    if (stored) {
      if (ig) {
        const r = await run('Instagram: publicar carrossel', () => publishInstagramCarousel(config, { instagramBusinessAccountId: ig, imageUrls: stored.slide_urls, caption: TEST_CAPTION }))
        if (r) results.push({ platform: 'instagram', externalPostId: r.externalPostId })
      }
      const f = await run('Facebook: publicar várias fotos', () => publishFacebookCarousel(config, { imageUrls: stored.slide_urls, caption: TEST_CAPTION }))
      if (f) results.push({ platform: 'facebook', externalPostId: f.externalPostId })
    }
  } else {
    const stored = await run('renderizar o vídeo (ffmpeg) e subir', () => renderAndStoreVideo({ supabase: service, unit: unit as Unit, organizationProfile: orgProfile, content: TEST_VIDEO, lang: 'pt' }))
    if (stored) {
      if (ig) {
        const r = await run('Instagram: publicar Reels', () => publishInstagramReel(config, { instagramBusinessAccountId: ig, videoUrl: stored.mp4_url, caption: TEST_CAPTION }))
        if (r) results.push({ platform: 'instagram', externalPostId: r.externalPostId })
      }
      const f = await run('Facebook: publicar vídeo', () => publishFacebookVideo(config, { videoUrl: stored.mp4_url, caption: TEST_CAPTION }))
      if (f) results.push({ platform: 'facebook', externalPostId: f.externalPostId })
    }
  }
  return NextResponse.json({ ok: steps.every((s) => s.ok), page: account.page_name, steps, results })
}
