// Login com Facebook pro Tráfego Pago (pedido do Vinicius, 2026-08-28):
// mesmo problema que o Gestor de Conteúdo já resolveu em 2026-08-22 (ver
// lib/content/meta-oauth.ts) — o fluxo de "compartilhar como Parceiro do
// Business Manager" funciona, mas é técnico demais e cheio de passo pra
// errar (achado real: cliente tentou conectar e recebeu "falta permissão"
// mesmo tendo compartilhado, provável erro no meio do caminho). Este módulo
// troca isso por "Conectar com Facebook": o cliente loga, escolhe a conta
// de anúncio, pronto.
//
// Reaproveita as peças genéricas de OAuth já existentes em
// lib/content/meta-oauth.ts (assinatura/verificação de state, troca de
// code por token de usuário de curta e depois longa duração) — só o que é
// específico de conta de anúncio (escopos, listagem via /me/adaccounts)
// mora aqui. Mesmo padrão de reaproveitamento cruzado que o resto do
// módulo de tráfego já usa (ex.: lib/content/meta-content.ts importa
// META_API_VERSION de lib/traffic/meta-ads.ts).
//
// Diferença importante em relação ao fluxo de Página: GET /me/accounts
// devolve um token JÁ PRÓPRIO de cada Página; GET /me/adaccounts não —
// o MESMO token de usuário de longa duração dá acesso a qualquer conta de
// anúncio que o usuário administra (basta trocar o act_<id> na URL da
// chamada). Por isso a sessão de escolha (traffic_oauth_sessions) guarda o
// token uma vez só, não por conta candidata.
//
// Escopos pedidos: ads_management (ler e operar campanhas), ads_read
// (leitura, redundante com ads_management mas explícito), business_management
// (visibilidade do Business Manager quando a conta pertencer a um).
//
// Permissão da Meta: assim como pages_manage_posts/instagram_content_publish
// no fluxo de Conteúdo, ads_management só funciona pra QUALQUER conta de
// cliente (não só admin/tester do app da Alizo) depois de App Review
// (Advanced Access) aprovado — ver docs/setup/traffic-apis-setup.md. Até lá,
// o login funciona normalmente pra contas de teste/admin do app.

import { META_API_VERSION } from './meta-ads'

const META_BASE_URL = `https://graph.facebook.com/${META_API_VERSION}`

/** Escopos pedidos no login — cobre leitura e operação de contas de anúncio. */
export const META_ADS_OAUTH_SCOPES = ['ads_management', 'ads_read', 'business_management'].join(',')

export function getMetaAdsAppCredentials(): { appId: string; appSecret: string; loginConfigId: string } | null {
  const appId = process.env.META_APP_ID?.trim()
  const appSecret = process.env.META_APP_SECRET?.trim()
  // Config de login separada da do Gestor de Conteúdo (META_LOGIN_CONFIG_ID)
  // — no painel da Meta, uma "Configuração de Login" empacota um conjunto
  // fixo de permissões pra um caso de uso específico; ads_management é um
  // caso de uso diferente de "gerenciar Página/Instagram", por isso tem seu
  // próprio config_id em vez de reaproveitar o mesmo.
  const loginConfigId = process.env.META_ADS_LOGIN_CONFIG_ID?.trim()
  if (!appId || !appSecret || !loginConfigId) return null
  return { appId, appSecret, loginConfigId }
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

/** GET /me/adaccounts — contas de anúncio que o usuário logado administra (mesmo token dá acesso a todas). */
export async function listManagedAdAccounts(
  userAccessToken: string,
): Promise<{ id: string; name: string; currency: string; account_status: number }[]> {
  const data = await metaGet<{ data: { id: string; name: string; currency: string; account_status: number }[] }>('me/adaccounts', {
    access_token: userAccessToken,
    fields: 'id,name,currency,account_status',
  })
  return data.data
}
