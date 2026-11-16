// Publica um content_post já aprovado (ou gerado em modo autônomo) na
// plataforma real, e grava o resultado de volta na linha — mesmo
// princípio de lib/traffic/executor.ts (auditável, nunca deixa o post
// "preso" sem status final).

import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveSocialConfig, publishFacebookCarousel, publishFacebookPhoto, publishFacebookVideo, publishInstagramCarousel, publishInstagramPost, publishInstagramReel, type SocialConfig } from './meta-content'
import { carouselPublishingEnabled } from './carousel'
import { videoPublishingEnabled } from './video'
import type { ContentPost, SocialAccount } from './types'

export type PublishOutcome = { ok: true; externalPostId: string } | { ok: false; error: string }

function isRetryableMetaError(message: string): boolean {
  const normalized = message.toLowerCase()
  return (
    normalized.includes('timeout aguardando processamento') ||
    normalized.includes('temporarily unavailable') ||
    normalized.includes('service unavailable') ||
    normalized.includes('rate limit') ||
    normalized.includes('try again later')
  )
}

export async function publishContentPost(
  supabase: SupabaseClient,
  params: { post: ContentPost; account: SocialAccount },
): Promise<PublishOutcome> {
  const { post, account } = params

  async function fail(error: string): Promise<PublishOutcome> {
    await supabase.from('content_posts').update({ status: 'failed', error_message: error }).eq('id', post.id)
    return { ok: false, error }
  }

  async function retryLater(error: string): Promise<PublishOutcome> {
    await supabase.from('content_posts').update({ status: 'approved', error_message: error }).eq('id', post.id)
    return { ok: false, error }
  }

  if (!post.image_url) return fail('Post sem imagem gerada.')

  // Vídeo: mesma regra do carrossel (CONTENT_VIDEO_PUBLISH=on). Desligada, o post segue aprovado e nada falha.
  if (post.format === 'video' && !videoPublishingEnabled()) {
    return { ok: false, error: 'Publicação de vídeo ainda não liberada: o post segue aprovado e sai quando a publicação for ligada.' }
  }

  // Carrossel só vai à Meta depois que o fluxo for validado numa página de teste (CONTENT_CAROUSEL_PUBLISH=on). Enquanto isso o post
  // fica como está — NÃO vira 'failed' — e quem chama decide o que mostrar.
  if (post.format === 'carousel' && !carouselPublishingEnabled()) {
    return { ok: false, error: 'Publicação de carrossel ainda não liberada: o post segue aprovado e sai quando a publicação for ligada.' }
  }

  try {
    const config = await resolveSocialConfig(account)
    if (!config) return fail('Conta sem token de Página configurado e sem system user global disponível.')

    if (post.format === 'video') {
      const videoUrl = post.video?.mp4_url
      if (!videoUrl) return fail('Vídeo sem arquivo renderizado.')
      const videoResult =
        post.platform === 'instagram'
          ? await publishInstagramReelContent(config, account, post, videoUrl)
          : await publishFacebookVideo(config, { videoUrl, caption: post.caption })
      await supabase
        .from('content_posts')
        .update({ status: 'published', published_at: new Date().toISOString(), external_post_id: videoResult.externalPostId, error_message: null })
        .eq('id', post.id)
      return { ok: true, externalPostId: videoResult.externalPostId }
    }

    const slideUrls = post.format === 'carousel' ? (post.carousel?.slide_urls ?? []) : []
    if (post.format === 'carousel' && slideUrls.length < 2) return fail('Carrossel sem slides desenhados.')
    const result =
      post.format === 'carousel'
        ? post.platform === 'instagram'
          ? await publishInstagramCarouselContent(config, account, post, slideUrls)
          : await publishFacebookCarousel(config, { imageUrls: slideUrls, caption: post.caption })
        : post.platform === 'instagram'
          ? await publishInstagramContent(config, account, post)
          : await publishFacebookPhoto(config, { imageUrl: post.image_url, caption: post.caption })

    await supabase
      .from('content_posts')
      .update({
        status: 'published',
        published_at: new Date().toISOString(),
        external_post_id: result.externalPostId,
        error_message: null,
      })
      .eq('id', post.id)

    return { ok: true, externalPostId: result.externalPostId }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao publicar o post.'
    return isRetryableMetaError(message) ? retryLater(message) : fail(message)
  }
}

/**
 * Publica todo post 'approved' cujo scheduled_for já tenha chegado
 * (planejamento semanal, pedido do Vinicius 2026-08-23) — chamada uma vez
 * por execução do cron diário, além (não em vez) do fluxo avulso de hoje.
 * Idempotente: uma vez publicado (ou falho), o status sai de 'approved' e
 * o post não é pego de novo na próxima execução.
 *
 * Achado real (2026-09-08, conta AlizoAi): a versão antiga só pegava post
 * agendado EXATAMENTE pra hoje (`gte(dayStart) e lt(dayEnd)`) — um post
 * aprovado com scheduled_for de um dia em que o cron não rodou (ou que só
 * foi aprovado depois da data agendada já ter passado) ficava 'approved'
 * pra sempre, nunca mais era pego em nenhuma execução futura, porque
 * "hoje" nunca mais bate com aquela data antiga. Contraria o próprio
 * pedido do Vinicius: "uma vez aprovado não precisa de mais ação nenhuma
 * humana, o funcionário posta sozinho" — sem filtro de início, agora
 * pega QUALQUER post 'approved' com scheduled_for até o fim de hoje
 * (agendado pra hoje OU atrasado), nunca deixa um post preso.
 */
export async function publishDueScheduledPosts(
  supabase: SupabaseClient,
  params: { today?: Date; maxPosts?: number } = {},
): Promise<{ published: number; errors: number }> {
  const today = params.today ?? new Date()
  const dayStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000)

  // Conteúdo avulso aprovado não tem scheduled_for. Antes a consulta usava
  // apenas `lt`, que exclui NULL no Postgres, e esses posts ficavam presos
  // para sempre. Mantemos duas consultas simples para tornar os dois grupos
  // explícitos e evitar depender da sintaxe textual de filtros `or`.
  const [{ data: scheduledDue }, { data: unscheduledDue }] = await Promise.all([
    supabase
      .from('content_posts')
      .select('*')
      .eq('status', 'approved')
      .lt('scheduled_for', dayEnd.toISOString()),
    supabase
      .from('content_posts')
      .select('*')
      .eq('status', 'approved')
      .is('scheduled_for', null),
  ])
  const due = [...((scheduledDue ?? []) as ContentPost[]), ...((unscheduledDue ?? []) as ContentPost[])]
  // Carrossel aprovado espera a publicação de carrossel ser ligada: não conta como erro nem é tentado todo dia.
  const carouselsOn = carouselPublishingEnabled()
  const videosOn = videoPublishingEnabled()
  const posts = due
    .filter((p) => (p.format !== 'carousel' || carouselsOn) && (p.format !== 'video' || videosOn))
    .sort((a, b) => {
      const aDate = a.scheduled_for ? new Date(a.scheduled_for).getTime() : new Date(a.created_at).getTime()
      const bDate = b.scheduled_for ? new Date(b.scheduled_for).getTime() : new Date(b.created_at).getTime()
      return aDate - bDate
    })
    .slice(0, params.maxPosts)

  // A Meta processa contêineres de vídeo de forma assíncrona e um Reel pode
  // levar até três minutos. Publicar o lote em paralelo mantém a execução
  // dentro do limite da função. O cron recorrente usa maxPosts=3 para não
  // sobrecarregar a conta e pega automaticamente o próximo lote.
  const outcomes = await Promise.all(posts.map(async (post) => {
    const { data: account } = await supabase.from('social_accounts').select('*').eq('id', post.social_account_id).maybeSingle()
    if (!account) return false
    return (await publishContentPost(supabase, { post, account: account as SocialAccount })).ok
  }))

  const published = outcomes.filter(Boolean).length
  const errors = outcomes.length - published
  return { published, errors }
}

async function publishInstagramContent(
  config: SocialConfig,
  account: SocialAccount,
  post: ContentPost,
): Promise<{ externalPostId: string }> {
  if (!account.instagram_business_account_id) {
    throw new Error('Nenhuma conta do Instagram vinculada a esta Página.')
  }
  return publishInstagramPost(config, {
    instagramBusinessAccountId: account.instagram_business_account_id,
    imageUrl: post.image_url!,
    caption: post.caption,
  })
}

async function publishInstagramCarouselContent(
  config: SocialConfig,
  account: SocialAccount,
  post: ContentPost,
  slideUrls: string[],
): Promise<{ externalPostId: string }> {
  if (!account.instagram_business_account_id) {
    throw new Error('Nenhuma conta do Instagram vinculada a esta Página.')
  }
  return publishInstagramCarousel(config, { instagramBusinessAccountId: account.instagram_business_account_id, imageUrls: slideUrls, caption: post.caption })
}

async function publishInstagramReelContent(config: SocialConfig, account: SocialAccount, post: ContentPost, videoUrl: string): Promise<{ externalPostId: string }> {
  if (!account.instagram_business_account_id) {
    throw new Error('Nenhuma conta do Instagram vinculada a esta Página.')
  }
  return publishInstagramReel(config, { instagramBusinessAccountId: account.instagram_business_account_id, videoUrl, caption: post.caption })
}
