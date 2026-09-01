import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { buildFacebookOAuthUrl, signOAuthState } from '@/lib/content/meta-oauth'
import { getMetaAdsAppCredentials } from '@/lib/traffic/meta-ads-oauth'

/**
 * Início do login com Facebook pro Tráfego Pago (pedido do Vinicius,
 * 2026-08-28) — mesmo fluxo de api/content/accounts/oauth/start/route.ts,
 * só que redireciona de volta pra /dashboard/traffic/connect e usa a
 * config de login de anúncios (META_ADS_LOGIN_CONFIG_ID). Navegação real de
 * página inteira, nunca via fetch/XHR — precisa abrir o diálogo do Facebook.
 */
export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const unitId = requestUrl.searchParams.get('unit_id')
  const connectPageUrl = new URL('/dashboard/traffic/connect', requestUrl.origin)

  if (!unitId) {
    connectPageUrl.searchParams.set('oauth_error', 'Selecione uma unidade antes de conectar com o Facebook.')
    return NextResponse.redirect(connectPageUrl)
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(new URL('/login', requestUrl.origin))

  const { data: unit } = await supabase.from('units').select('id').eq('id', unitId).maybeSingle()
  if (!unit) {
    connectPageUrl.searchParams.set('oauth_error', 'Unidade não encontrada ou sem permissão.')
    return NextResponse.redirect(connectPageUrl)
  }

  const credentials = getMetaAdsAppCredentials()
  if (!credentials) {
    connectPageUrl.searchParams.set(
      'oauth_error',
      'O login com Facebook pra anúncios ainda não está disponível — o time da Alizo precisa configurar o app da Meta primeiro.',
    )
    return NextResponse.redirect(connectPageUrl)
  }

  const redirectUri = new URL('/api/traffic/accounts/oauth/callback', requestUrl.origin).toString()
  const state = signOAuthState({ unitId }, credentials.appSecret)
  const authorizeUrl = buildFacebookOAuthUrl({ appId: credentials.appId, redirectUri, state, configId: credentials.loginConfigId })

  return NextResponse.redirect(authorizeUrl)
}
