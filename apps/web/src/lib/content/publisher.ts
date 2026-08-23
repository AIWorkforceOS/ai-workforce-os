// Publica um content_post já aprovado (ou gerado em modo autônomo) na
// plataforma real, e grava o resultado de volta na linha — mesmo
// princípio de lib/traffic/executor.ts (auditável, nunca deixa o post
// "preso" sem status final).

import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveSocialConfig, publishFacebookPhoto, publishInstagramPost, type SocialConfig } from './meta-content'
import type { ContentPost, SocialAccount } from './types'

export type PublishOutcome = { ok: true; externalPostId: string } | { ok: false; error: string }

export async function publishContentPost(
  supabase: SupabaseClient,
  params: { post: ContentPost; account: SocialAccount },
): Promise<PublishOutcome> {
  const { post, account } = params

  async function fail(error: string): Promise<PublishOutcome> {
    await supabase.from('content_posts').update({ status: 'failed', error_message: error }).eq('id', post.id)
    return { ok: false, error }
  }

  if (!post.image_url) return fail('Post sem imagem gerada.')

  try {
    const config = await resolveSocialConfig(account)
    if (!config) return fail('Conta sem token de Página configurado e sem system user global disponível.')

    const result =
      post.platform === 'instagram'
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
    return fail(error instanceof Error ? error.message : 'Falha ao publicar o post.')
  }
}

/**
 * Publica todo post 'approved' cujo scheduled_for caia no dia informado
 * (planejamento semanal, pedido do Vinicius 2026-08-23) — chamada uma vez
 * por execução do cron diário, além (não em vez) do fluxo avulso de hoje.
 * Idempotente: uma vez publicado (ou falho), o status sai de 'approved' e
 * o post não é pego de novo na próxima execução.
 */
export async function publishDueScheduledPosts(
  supabase: SupabaseClient,
  params: { today?: Date } = {},
): Promise<{ published: number; errors: number }> {
  const today = params.today ?? new Date()
  const dayStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000)

  const { data: due } = await supabase
    .from('content_posts')
    .select('*')
    .eq('status', 'approved')
    .gte('scheduled_for', dayStart.toISOString())
    .lt('scheduled_for', dayEnd.toISOString())
  const posts = (due ?? []) as ContentPost[]

  let published = 0
  let errors = 0
  for (const post of posts) {
    const { data: account } = await supabase.from('social_accounts').select('*').eq('id', post.social_account_id).maybeSingle()
    if (!account) {
      errors += 1
      continue
    }
    const outcome = await publishContentPost(supabase, { post, account: account as SocialAccount })
    if (outcome.ok) published += 1
    else errors += 1
  }
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
