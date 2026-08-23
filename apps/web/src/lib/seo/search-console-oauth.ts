// Login com Google Search Console pro funcionário de SEO (pedido do
// Vinicius, 2026-08-23: "ele precisa de fato trabalhar, buscar resultados
// ... fazer análises nos Sites indicados") — o Search Console é a fonte
// OFICIAL e gratuita de desempenho real de busca (cliques, impressões,
// posição média), diferente do rank tracking via SerpApi (pago, nunca
// configurado) que só existia em código.
//
// Fluxo (mesmo padrão do login com Facebook do Conteúdo — ver
// lib/content/meta-oauth.ts):
//   1) GET /api/seo/gsc/oauth/start — monta a URL de autorização do Google
//      com um state assinado (signOAuthState, reaproveitado de
//      meta-oauth.ts — função pura, agnóstica de provedor) e redireciona.
//   2) Cliente loga na conta Google que já tem o site verificado no
//      Search Console e autoriza (escopo webmasters.readonly).
//   3) GET /api/seo/gsc/oauth/callback — verifica o state, troca o code por
//      access+refresh token (exchangeCodeForTokens), lista as propriedades
//      verificadas dessa conta (listVerifiedSites).
//   4) Uma propriedade só → conecta direto em seo_search_console_accounts.
//      Mais de uma → grava em seo_gsc_oauth_sessions e o cliente escolhe;
//      POST .../oauth/finalize grava a escolhida.
//
// access_type=offline + prompt=consent força o Google a devolver um
// refresh_token mesmo que o usuário já tenha autorizado este app antes —
// sem isso, reconexões subsequentes só devolveriam access_token (que
// expira em ~1h) e o cron perderia acesso depois da primeira hora.

export { signOAuthState, verifyOAuthState } from '@/lib/content/meta-oauth'

const GOOGLE_OAUTH_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const SEARCH_CONSOLE_API_BASE = 'https://www.googleapis.com/webmasters/v3'

export const GOOGLE_SEARCH_CONSOLE_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly'

/** Minutos até uma sessão de escolha de propriedade (seo_gsc_oauth_sessions) expirar. */
export const GSC_OAUTH_SESSION_TTL_MINUTES = 15

export function getGoogleSearchConsoleCredentials(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.GOOGLE_SEARCH_CONSOLE_CLIENT_ID?.trim()
  const clientSecret = process.env.GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET?.trim()
  if (!clientId || !clientSecret) return null
  return { clientId, clientSecret }
}

/** Monta a URL de autorização do Google — função pura, testável sem rede. */
export function buildGoogleOAuthUrl(params: { clientId: string; redirectUri: string; state: string }): string {
  const url = new URL(GOOGLE_OAUTH_AUTHORIZE_URL)
  url.searchParams.set('client_id', params.clientId)
  url.searchParams.set('redirect_uri', params.redirectUri)
  url.searchParams.set('state', params.state)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', GOOGLE_SEARCH_CONSOLE_SCOPE)
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent')
  return url.toString()
}

type GoogleTokenErrorBody = { error?: string; error_description?: string }

/** Passo 1 da troca: authorization code (do redirect do Google) → access + refresh token. */
export async function exchangeCodeForTokens(params: {
  code: string
  redirectUri: string
  clientId: string
  clientSecret: string
}): Promise<{ accessToken: string; refreshToken: string; expiresInSeconds: number }> {
  const response = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: params.code,
      redirect_uri: params.redirectUri,
      client_id: params.clientId,
      client_secret: params.clientSecret,
    }),
  })
  const data = (await response.json()) as GoogleTokenErrorBody & {
    access_token?: string
    refresh_token?: string
    expires_in?: number
  }
  if (!response.ok || !data.access_token) {
    throw new Error(`Google OAuth (troca de code) falhou: ${data.error_description ?? data.error ?? `status ${response.status}`}`)
  }
  if (!data.refresh_token) {
    throw new Error(
      'O Google não devolveu um refresh token — provavelmente esta conta já autorizou o app antes sem revogar o acesso. Revogue o acesso em myaccount.google.com/permissions e tente conectar de novo.',
    )
  }
  return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresInSeconds: data.expires_in ?? 3600 }
}

/** Renova o access token a partir do refresh token — usado pelo cron antes de cada consulta ao Search Console. */
export async function refreshAccessToken(params: {
  refreshToken: string
  clientId: string
  clientSecret: string
}): Promise<{ accessToken: string; expiresInSeconds: number }> {
  const response = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: params.refreshToken,
      client_id: params.clientId,
      client_secret: params.clientSecret,
    }),
  })
  const data = (await response.json()) as GoogleTokenErrorBody & { access_token?: string; expires_in?: number }
  if (!response.ok || !data.access_token) {
    throw new Error(`Google OAuth (renovação de token) falhou: ${data.error_description ?? data.error ?? `status ${response.status}`}`)
  }
  return { accessToken: data.access_token, expiresInSeconds: data.expires_in ?? 3600 }
}

type GscSite = { siteUrl: string; permissionLevel: string }

/**
 * Lista as propriedades do Search Console que esta conta Google pode
 * consultar — filtra fora `siteUnverifiedUser` (a API lista até
 * propriedades não verificadas por este usuário; sem permissão de leitura
 * real, não adianta oferecer como opção).
 */
export async function listVerifiedSites(accessToken: string): Promise<string[]> {
  const response = await fetch(`${SEARCH_CONSOLE_API_BASE}/sites`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  const data = (await response.json()) as GoogleTokenErrorBody & { siteEntry?: GscSite[] }
  if (!response.ok) {
    throw new Error(`Não foi possível listar as propriedades do Search Console: ${data.error_description ?? data.error ?? `status ${response.status}`}`)
  }
  return (data.siteEntry ?? []).filter((site) => site.permissionLevel !== 'siteUnverifiedUser').map((site) => site.siteUrl)
}
