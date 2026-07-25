// Cliente mínimo da Graph API (Meta) para publicação ORGÂNICA no
// Instagram (via conta Business vinculada à Página) e no Facebook
// (Página). Distinto de lib/traffic/meta-ads.ts (anúncios pagos, escopo
// ads_management): aqui a credencial é um token de PÁGINA de longa
// duração com escopos pages_manage_posts, pages_read_engagement,
// instagram_basic, instagram_content_publish.
//
// Endpoints usados (developers.facebook.com/docs/pages-api,
// developers.facebook.com/docs/instagram-api/guides/content-publishing):
//   GET  /{page-id}?fields=name,instagram_business_account
//   GET  /{ig-business-id}?fields=username
//   POST /{page-id}/photos                — publica foto na Página (Facebook)
//   POST /{ig-business-id}/media           — cria o container de mídia (Instagram)
//   POST /{ig-business-id}/media_publish   — publica o container criado
//
// Degradação graciosa: sem token configurado, getSocialConfig retorna
// null e quem chama registra system_event em vez de quebrar (padrão do OS).

import { META_API_VERSION } from '@/lib/traffic/meta-ads'

const META_BASE_URL = `https://graph.facebook.com/${META_API_VERSION}`

export type SocialConfig = {
  pageAccessToken: string
  pageId: string
}

export function getSocialConfig(account: {
  page_id: string
  page_access_token: string | null
}): SocialConfig | null {
  if (!account.page_access_token) return null
  return { pageAccessToken: account.page_access_token, pageId: account.page_id }
}

type MetaErrorBody = { error?: { message?: string; type?: string; code?: number } }

async function socialGet<T>(path: string, accessToken: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${META_BASE_URL}/${path}`)
  url.searchParams.set('access_token', accessToken)
  for (const [key, value] of Object.entries(params ?? {})) url.searchParams.set(key, value)

  const response = await fetch(url.toString())
  const data = (await response.json()) as T & MetaErrorBody

  if (!response.ok) {
    const err = data.error
    throw new Error(
      `Meta API ${path} falhou: ${err?.message ?? `status ${response.status}`}${err?.code ? ` (code ${err.code})` : ''}`,
    )
  }
  return data
}

async function socialPost<T>(path: string, accessToken: string, body: Record<string, string>): Promise<T> {
  const form = new URLSearchParams({ ...body, access_token: accessToken })

  const response = await fetch(`${META_BASE_URL}/${path}`, { method: 'POST', body: form })
  const data = (await response.json()) as T & MetaErrorBody

  if (!response.ok) {
    const err = data.error
    throw new Error(
      `Meta API POST /${path} falhou: ${err?.message ?? `status ${response.status}`}${err?.code ? ` (code ${err.code})` : ''}`,
    )
  }
  return data
}

export type PageInfo = {
  id: string
  name: string
  instagramBusinessAccountId: string | null
  instagramUsername: string | null
}

/** Usado tanto pelo teste de conexão quanto para descobrir o IG vinculado à Página. */
export async function getPageInfo(config: SocialConfig): Promise<PageInfo> {
  const page = await socialGet<{ id: string; name: string; instagram_business_account?: { id: string } }>(
    config.pageId,
    config.pageAccessToken,
    { fields: 'name,instagram_business_account' },
  )

  let instagramUsername: string | null = null
  const instagramBusinessAccountId = page.instagram_business_account?.id ?? null
  if (instagramBusinessAccountId) {
    const ig = await socialGet<{ username?: string }>(instagramBusinessAccountId, config.pageAccessToken, {
      fields: 'username',
    })
    instagramUsername = ig.username ?? null
  }

  return { id: page.id, name: page.name, instagramBusinessAccountId, instagramUsername }
}

export async function publishFacebookPhoto(
  config: SocialConfig,
  params: { imageUrl: string; caption: string },
): Promise<{ externalPostId: string }> {
  const result = await socialPost<{ id: string; post_id?: string }>(`${config.pageId}/photos`, config.pageAccessToken, {
    url: params.imageUrl,
    caption: params.caption,
  })
  return { externalPostId: result.post_id ?? result.id }
}

export async function publishInstagramPost(
  config: SocialConfig,
  params: { instagramBusinessAccountId: string; imageUrl: string; caption: string },
): Promise<{ externalPostId: string }> {
  const container = await socialPost<{ id: string }>(`${params.instagramBusinessAccountId}/media`, config.pageAccessToken, {
    image_url: params.imageUrl,
    caption: params.caption,
  })
  const published = await socialPost<{ id: string }>(
    `${params.instagramBusinessAccountId}/media_publish`,
    config.pageAccessToken,
    { creation_id: container.id },
  )
  return { externalPostId: published.id }
}
