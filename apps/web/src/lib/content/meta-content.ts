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
// Degradação graciosa: sem token configurado e sem META_SYSTEM_USER_TOKEN
// global, resolveSocialConfig retorna null e quem chama registra
// system_event em vez de quebrar (padrão do OS).
//
// Caminho padrão (sem token do cliente): a Página é compartilhada como
// Parceiro do Business Manager da Alizo (ver META_BUSINESS_MANAGER_ID em
// lib/integrations.ts e docs/setup/traffic-apis-setup.md). Com isso, o
// system user global (META_SYSTEM_USER_TOKEN) consegue trocar por um token
// de Página em tempo real via GET /{page-id}?fields=access_token — não
// precisamos mais que o cliente gere e cole um token de Página. O campo
// page_access_token da conta continua existindo só para o caso avançado
// (raro) de alguém que já tem seu próprio token de longa duração.

import { META_API_VERSION } from '@/lib/traffic/meta-ads'

const META_BASE_URL = `https://graph.facebook.com/${META_API_VERSION}`

export type SocialConfig = {
  pageAccessToken: string
  pageId: string
}

/**
 * Resolve a credencial de Página: token salvo na conta (avançado/manual)
 * com fallback para um token derivado em tempo real do system user global
 * da Alizo, via troca de token de Página (exige que a Página tenha sido
 * compartilhada como Parceiro do Business Manager da Alizo). Retorna null
 * quando não há token manual nem META_SYSTEM_USER_TOKEN configurado.
 */
export async function resolveSocialConfig(account: {
  page_id: string
  page_access_token: string | null
}): Promise<SocialConfig | null> {
  if (account.page_access_token) {
    return { pageAccessToken: account.page_access_token, pageId: account.page_id }
  }

  const systemUserToken = process.env.META_SYSTEM_USER_TOKEN
  if (!systemUserToken) return null

  const pageAccessToken = await fetchPageAccessTokenViaSystemUser(account.page_id, systemUserToken)
  return { pageAccessToken, pageId: account.page_id }
}

/** GET /{page-id}?fields=access_token — troca o token do system user por um token de Página. */
async function fetchPageAccessTokenViaSystemUser(pageId: string, systemUserToken: string): Promise<string> {
  const url = new URL(`${META_BASE_URL}/${pageId}`)
  url.searchParams.set('fields', 'access_token')
  url.searchParams.set('access_token', systemUserToken)

  const response = await fetch(url.toString())
  const data = (await response.json()) as { access_token?: string } & MetaErrorBody

  if (!response.ok || !data.access_token) {
    const err = data.error
    throw new Error(
      `Não foi possível obter o token da Página a partir do usuário do sistema da Alizo: ${err?.message ?? `status ${response.status}`}${err?.code ? ` (code ${err.code})` : ''}`,
    )
  }
  return data.access_token
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

const CONTAINER_POLL_INTERVAL_MS = 2000
const CONTAINER_POLL_MAX_ATTEMPTS = 10 // ~20s no total — o endpoint de aprovação tem 60s de orçamento

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * O container de mídia do Instagram (POST /{ig}/media) é assíncrono: a Meta
 * ainda está baixando/processando a imagem quando a chamada retorna. Chamar
 * media_publish antes disso terminar dá "Media ID is not available" (code
 * 9007) — reproduzido ao vivo em 2026-08-23 publicando de verdade pro
 * @mawicleaning. Aqui a gente espera o status_code virar FINISHED antes de
 * publicar (developers.facebook.com/docs/instagram-api/guides/content-publishing#publish-content).
 */
async function waitForMediaContainerReady(
  containerId: string,
  accessToken: string,
  opts: { pollIntervalMs?: number; maxAttempts?: number } = {},
): Promise<void> {
  const pollIntervalMs = opts.pollIntervalMs ?? CONTAINER_POLL_INTERVAL_MS
  const maxAttempts = opts.maxAttempts ?? CONTAINER_POLL_MAX_ATTEMPTS

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const status = await socialGet<{ status_code?: string }>(containerId, accessToken, { fields: 'status_code' })
    if (status.status_code === 'FINISHED') return
    if (status.status_code === 'ERROR' || status.status_code === 'EXPIRED') {
      throw new Error(`Container de mídia do Instagram falhou ao processar (status ${status.status_code}).`)
    }
    if (attempt < maxAttempts - 1) await sleep(pollIntervalMs)
  }
  throw new Error('Container de mídia do Instagram não ficou pronto a tempo (timeout aguardando processamento).')
}

export async function publishInstagramPost(
  config: SocialConfig,
  params: { instagramBusinessAccountId: string; imageUrl: string; caption: string },
  pollOpts?: { pollIntervalMs?: number; maxAttempts?: number },
): Promise<{ externalPostId: string }> {
  const container = await socialPost<{ id: string }>(`${params.instagramBusinessAccountId}/media`, config.pageAccessToken, {
    image_url: params.imageUrl,
    caption: params.caption,
  })
  await waitForMediaContainerReady(container.id, config.pageAccessToken, pollOpts)
  const published = await socialPost<{ id: string }>(
    `${params.instagramBusinessAccountId}/media_publish`,
    config.pageAccessToken,
    { creation_id: container.id },
  )
  return { externalPostId: published.id }
}
