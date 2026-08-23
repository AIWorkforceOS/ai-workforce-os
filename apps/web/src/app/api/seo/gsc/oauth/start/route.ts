import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { buildGoogleOAuthUrl, getGoogleSearchConsoleCredentials, signOAuthState } from '@/lib/seo/search-console-oauth'

/**
 * Início do login com Google Search Console (pedido do Vinicius,
 * 2026-08-23): o cliente clica "Conectar Google Search Console" em
 * /dashboard/seo, esta rota monta a URL de autorização e redireciona
 * (302) pra accounts.google.com. Nunca chamado via fetch/XHR — precisa ser
 * navegação real pro diálogo de login abrir. Mesmo padrão de
 * api/content/accounts/oauth/start.
 */
export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const unitId = requestUrl.searchParams.get('unit_id')
  const seoPageUrl = new URL('/dashboard/seo', requestUrl.origin)

  if (!unitId) {
    seoPageUrl.searchParams.set('oauth_error', 'Selecione uma unidade antes de conectar o Search Console.')
    return NextResponse.redirect(seoPageUrl)
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(new URL('/login', requestUrl.origin))

  const { data: unit } = await supabase.from('units').select('id').eq('id', unitId).maybeSingle()
  if (!unit) {
    seoPageUrl.searchParams.set('oauth_error', 'Unidade não encontrada ou sem permissão.')
    return NextResponse.redirect(seoPageUrl)
  }

  const credentials = getGoogleSearchConsoleCredentials()
  if (!credentials) {
    seoPageUrl.searchParams.set(
      'oauth_error',
      'A conexão com o Google Search Console ainda não está disponível — o time da Alizo precisa configurar as credenciais do Google primeiro.',
    )
    return NextResponse.redirect(seoPageUrl)
  }

  const redirectUri = new URL('/api/seo/gsc/oauth/callback', requestUrl.origin).toString()
  const state = signOAuthState({ unitId }, credentials.clientSecret)
  const authorizeUrl = buildGoogleOAuthUrl({ clientId: credentials.clientId, redirectUri, state })

  return NextResponse.redirect(authorizeUrl)
}
