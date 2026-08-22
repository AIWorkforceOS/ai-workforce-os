// Login com Facebook pro Gestor de Conteúdo (pedido do Vinicius, 2026-08-22):
// substitui a exigência de o cliente colar o ID da Página / compartilhar
// como Parceiro do Business Manager (funciona, mas é técnico demais pro
// dono de negócio comum) por um fluxo padrão OAuth — "Conectar com
// Facebook", o cliente loga na própria conta, escolhe a Página, pronto.
//
// Fluxo (Facebook Login for Business, developers.facebook.com/docs/facebook-login):
//   1) GET /api/content/accounts/oauth/start — monta a URL de autorização
//      (buildFacebookOAuthUrl) com um state assinado e redireciona.
//   2) Cliente loga e aprova no facebook.com; ele redireciona de volta com
//      ?code=...&state=...
//   3) GET /api/content/accounts/oauth/callback — verifica o state
//      (verifyOAuthState), troca o code por um token de usuário de curta
//      duração (exchangeCodeForUserToken) e esse por um de LONGA duração
//      (exchangeForLongLivedToken — só esse é salvo/usado depois).
//   4) listManagedPages busca as Páginas que esse usuário administra, cada
//      uma já com seu PRÓPRIO token de Página (derivado de um token de
//      usuário de longa duração, o token de Página também não expira
//      sozinho enquanto o usuário continuar admin — mesma garantia do
//      token de system user que o resto do módulo já usa).
//   5) Uma Página só → conecta direto. Mais de uma → grava a lista em
//      content_oauth_sessions (poucos minutos) e o cliente escolhe na UI;
//      POST .../oauth/finalize grava a escolhida em social_accounts.
//
// Escopos pedidos: pages_show_list (listar), pages_manage_posts +
// pages_read_engagement (publicar/ler a Página), instagram_basic +
// instagram_content_publish (publicar no Instagram vinculado),
// business_management (visibilidade do Business Manager quando houver).
//
// Permissão da Meta: para o app funcionar com QUALQUER conta de cliente
// (não só admins/testers do próprio app da Alizo no Meta for Developers),
// pages_manage_posts e instagram_content_publish exigem App Review
// (Advanced Access) aprovado — sem isso, o login funciona mas só pra
// contas cadastradas como admin/developer/tester do app. Ver
// docs/setup/content-oauth-setup.md.

import { randomBytes, createHmac, timingSafeEqual } from 'crypto'
import { META_API_VERSION } from '@/lib/traffic/meta-ads'
import { getPageInfo, type SocialConfig } from './meta-content'
import type { OAuthCandidatePage } from './types'

const META_BASE_URL = `https://graph.facebook.com/${META_API_VERSION}`
const META_OAUTH_DIALOG_URL = `https://www.facebook.com/${META_API_VERSION}/dialog/oauth`

/** Escopos pedidos no login — cobre Página (Facebook) + Instagram Business vinculado. */
export const META_OAUTH_SCOPES = [
  'pages_show_list',
  'pages_manage_posts',
  'pages_read_engagement',
  'instagram_basic',
  'instagram_content_publish',
  'business_management',
].join(',')

/** Minutos até uma sessão de escolha de Página (content_oauth_sessions) expirar. */
export const OAUTH_SESSION_TTL_MINUTES = 15
/** Minutos até um `state` assinado (start → callback) ser considerado velho demais — CSRF/replay. */
const OAUTH_STATE_TTL_MINUTES = 10

export function getMetaAppCredentials(): { appId: string; appSecret: string } | null {
  const appId = process.env.META_APP_ID?.trim()
  const appSecret = process.env.META_APP_SECRET?.trim()
  if (!appId || !appSecret) return null
  return { appId, appSecret }
}

/** Monta a URL de autorização do Facebook Login — função pura, testável sem rede. */
export function buildFacebookOAuthUrl(params: { appId: string; redirectUri: string; state: string }): string {
  const url = new URL(META_OAUTH_DIALOG_URL)
  url.searchParams.set('client_id', params.appId)
  url.searchParams.set('redirect_uri', params.redirectUri)
  url.searchParams.set('state', params.state)
  url.searchParams.set('scope', META_OAUTH_SCOPES)
  url.searchParams.set('response_type', 'code')
  return url.toString()
}

type OAuthStatePayload = { unitId: string; nonce: string; ts: number }

/**
 * Assina {unitId, nonce, timestamp} pra viajar ida e volta no parâmetro
 * `state` do OAuth (CSRF + qual unidade iniciou a conexão) sem precisar de
 * sessão/cookie próprio — o próprio HMAC (com META_APP_SECRET, que já
 * precisa existir pro fluxo funcionar) garante que ninguém forjou o valor.
 */
export function signOAuthState(payload: { unitId: string; nonce?: string }, appSecret: string): string {
  const full: OAuthStatePayload = { unitId: payload.unitId, nonce: payload.nonce ?? randomBytes(9).toString('base64url'), ts: Date.now() }
  const encoded = Buffer.from(JSON.stringify(full)).toString('base64url')
  const signature = createHmac('sha256', appSecret).update(encoded).digest('base64url')
  return `${encoded}.${signature}`
}

/** Verifica um `state` assinado por signOAuthState — retorna null se inválido, adulterado ou velho demais. */
export function verifyOAuthState(state: string, appSecret: string): { unitId: string } | null {
  const parts = state.split('.')
  if (parts.length !== 2) return null
  const [encoded, signature] = parts as [string, string]

  const expectedSignature = createHmac('sha256', appSecret).update(encoded).digest('base64url')
  const sigBuffer = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expectedSignature)
  if (sigBuffer.length !== expectedBuffer.length || !timingSafeEqual(sigBuffer, expectedBuffer)) return null

  let payload: OAuthStatePayload
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf-8')) as OAuthStatePayload
  } catch {
    return null
  }
  if (typeof payload.unitId !== 'string' || typeof payload.ts !== 'number') return null
  if (Date.now() - payload.ts > OAUTH_STATE_TTL_MINUTES * 60_000) return null

  return { unitId: payload.unitId }
}

type MetaErrorBody = { error?: { message?: string; type?: string; code?: number } }

async function metaGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`${META_BASE_URL}/${path}`)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)

  const response = await fetch(url.toString())
  const data = (await response.json()) as T & MetaErrorBody
  if (!response.ok) {
    const err = data.error
    throw new Error(`Meta OAuth ${path} falhou: ${err?.message ?? `status ${response.status}`}${err?.code ? ` (code ${err.code})` : ''}`)
  }
  return data
}

/** Passo 1 da troca: authorization code (do redirect do Facebook) → token de usuário de curta duração. */
export async function exchangeCodeForUserToken(params: {
  code: string
  redirectUri: string
  appId: string
  appSecret: string
}): Promise<{ accessToken: string }> {
  const data = await metaGet<{ access_token: string }>('oauth/access_token', {
    client_id: params.appId,
    client_secret: params.appSecret,
    redirect_uri: params.redirectUri,
    code: params.code,
  })
  return { accessToken: data.access_token }
}

/** Passo 2: token de usuário curto → longo (~60 dias, e o token de Página derivado dele não expira sozinho enquanto o usuário continuar admin). */
export async function exchangeForLongLivedToken(params: {
  shortLivedToken: string
  appId: string
  appSecret: string
}): Promise<{ accessToken: string }> {
  const data = await metaGet<{ access_token: string }>('oauth/access_token', {
    grant_type: 'fb_exchange_token',
    client_id: params.appId,
    client_secret: params.appSecret,
    fb_exchange_token: params.shortLivedToken,
  })
  return { accessToken: data.access_token }
}

/** GET /me/accounts — Páginas que o usuário logado administra, cada uma já com seu próprio token de Página. */
export async function listManagedPages(userAccessToken: string): Promise<{ id: string; name: string; access_token: string }[]> {
  const data = await metaGet<{ data: { id: string; name: string; access_token: string }[] }>('me/accounts', {
    access_token: userAccessToken,
    fields: 'id,name,access_token',
  })
  return data.data
}

/** Completa uma Página candidata com o Instagram Business vinculado (se houver) — reusa getPageInfo, mesma chamada que o resto do módulo já usa. */
export async function enrichCandidatePage(page: { id: string; name: string; access_token: string }): Promise<OAuthCandidatePage> {
  const config: SocialConfig = { pageId: page.id, pageAccessToken: page.access_token }
  const info = await getPageInfo(config)
  return {
    id: page.id,
    name: page.name,
    access_token: page.access_token,
    instagram_business_account_id: info.instagramBusinessAccountId,
    instagram_username: info.instagramUsername,
  }
}
