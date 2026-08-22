import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { buildFacebookOAuthUrl, getMetaAppCredentials, signOAuthState } from '@/lib/content/meta-oauth'

/**
 * Início do login com Facebook (pedido do Vinicius, 2026-08-22): o cliente
 * clica "Conectar com Facebook" em /dashboard/content/connect (link normal,
 * navegação de página inteira — não é XHR), esta rota monta a URL de
 * autorização e redireciona (302) pro facebook.com. Nunca chamado via
 * fetch/XHR — precisa ser navegação real pro diálogo de login abrir.
 */
export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const unitId = requestUrl.searchParams.get('unit_id')
  const connectPageUrl = new URL('/dashboard/content/connect', requestUrl.origin)

  if (!unitId) {
    connectPageUrl.searchParams.set('oauth_error', 'Selecione uma unidade antes de conectar com o Facebook.')
    return NextResponse.redirect(connectPageUrl)
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(new URL('/login', requestUrl.origin))

  // Confirma que o usuário logado tem acesso a esta unidade (RLS) antes de sair pro Facebook.
  const { data: unit } = await supabase.from('units').select('id').eq('id', unitId).maybeSingle()
  if (!unit) {
    connectPageUrl.searchParams.set('oauth_error', 'Unidade não encontrada ou sem permissão.')
    return NextResponse.redirect(connectPageUrl)
  }

  const credentials = getMetaAppCredentials()
  if (!credentials) {
    connectPageUrl.searchParams.set(
      'oauth_error',
      'O login com Facebook ainda não está disponível — o time da Alizo precisa configurar o app da Meta primeiro.',
    )
    return NextResponse.redirect(connectPageUrl)
  }

  const redirectUri = new URL('/api/content/accounts/oauth/callback', requestUrl.origin).toString()
  const state = signOAuthState({ unitId }, credentials.appSecret)
  const authorizeUrl = buildFacebookOAuthUrl({ appId: credentials.appId, redirectUri, state })

  return NextResponse.redirect(authorizeUrl)
}
