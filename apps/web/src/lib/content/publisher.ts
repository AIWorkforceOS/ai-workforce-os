// Publica um content_post já aprovado (ou gerado em modo autônomo) na
// plataforma real, e grava o resultado de volta na linha — mesmo
// princípio de lib/traffic/executor.ts (auditável, nunca deixa o post
// "preso" sem status final).

import type { SupabaseClient } from '@supabase/supabase-js'
import { getSocialConfig, publishFacebookPhoto, publishInstagramPost, type SocialConfig } from './meta-content'
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

  const config = getSocialConfig(account)
  if (!config) return fail('Conta sem token de Página configurado.')
  if (!post.image_url) return fail('Post sem imagem gerada.')

  try {
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
