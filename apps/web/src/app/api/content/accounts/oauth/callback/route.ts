import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logSystemEvent } from '@/lib/system-events'
import { translateIntegrationError } from '@/lib/integration-errors'
import {
  enrichCandidatePage,
  exchangeCodeForUserToken,
  exchangeForLongLivedToken,
  getMetaAppCredentials,
  listManagedPages,
  verifyOAuthState,
  OAUTH_SESSION_TTL_MINUTES,
} from '@/lib/content/meta-oauth'

/**
 * Volta do login com Facebook: troca o code por token, lista as Páginas do
 * usuário e ou já conecta (1 Página) ou grava uma sessão temporária pra
 * escolha (mais de uma) — ver lib/content/meta-oauth.ts pro fluxo completo.
 */
export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const connectPageUrl = new URL('/dashboard/content/connect', requestUrl.origin)

  function fail(message: string) {
    connectPageUrl.searchParams.set('oauth_error', message)
    return NextResponse.redirect(connectPageUrl)
  }

  // Cliente negou a autorização, ou o Facebook devolveu erro.
  const oauthError = requestUrl.searchParams.get('error_description') ?? requestUrl.searchParams.get('error')
  if (oauthError) return fail('Não foi possível concluir o login com Facebook — a autorização não foi concedida.')

  const code = requestUrl.searchParams.get('code')
  const state = requestUrl.searchParams.get('state')
  if (!code || !state) return fail('Resposta inválida do Facebook — tente conectar novamente.')

  const credentials = getMetaAppCredentials()
  if (!credentials) return fail('O login com Facebook ainda não está disponível — o time da Alizo precisa configurar o app da Meta primeiro.')

  const verified = verifyOAuthState(state, credentials.appSecret)
  if (!verified) return fail('Sessão de login expirada ou inválida — tente conectar de novo.')

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(new URL('/login', requestUrl.origin))

  const { data: unit } = await supabase.from('units').select('id, org_id').eq('id', verified.unitId).maybeSingle()
  if (!unit?.org_id) return fail('Unidade não encontrada ou sem permissão.')

  const redirectUri = new URL('/api/content/accounts/oauth/callback', requestUrl.origin).toString()

  try {
    const { accessToken: shortLivedToken } = await exchangeCodeForUserToken({
      code,
      redirectUri,
      appId: credentials.appId,
      appSecret: credentials.appSecret,
    })
    const { accessToken: longLivedToken } = await exchangeForLongLivedToken({
      shortLivedToken,
      appId: credentials.appId,
      appSecret: credentials.appSecret,
    })

    const pages = await listManagedPages(longLivedToken)
    if (pages.length === 0) {
      return fail(
        'Nenhuma Página do Facebook encontrada nessa conta — confirme que você é administrador(a) de pelo menos uma Página e tente de novo.',
      )
    }

    if (pages.length === 1) {
      const enriched = await enrichCandidatePage(pages[0]!)
      const { error } = await supabase.from('social_accounts').upsert(
        {
          org_id: unit.org_id,
          unit_id: unit.id,
          platform: 'meta',
          page_id: enriched.id,
          page_name: enriched.name,
          page_access_token: enriched.access_token,
          instagram_business_account_id: enriched.instagram_business_account_id,
          instagram_username: enriched.instagram_username,
          connection_status: 'connected',
          connection_error: null,
        },
        { onConflict: 'unit_id,page_id' },
      )
      if (error) return fail('Conectamos com o Facebook, mas não conseguimos salvar a Página — tente de novo.')

      await logSystemEvent(supabase, {
        level: 'info',
        source: 'content',
        eventType: 'content_oauth_connected',
        message: `Cliente conectou a Página "${enriched.name}" via login com Facebook.`,
        orgId: unit.org_id,
        unitId: unit.id,
      })

      connectPageUrl.searchParams.set('oauth_success', enriched.name)
      return NextResponse.redirect(connectPageUrl)
    }

    // Mais de uma Página — grava as candidatas e deixa o cliente escolher.
    const enrichedPages = await Promise.all(pages.map(enrichCandidatePage))
    const expiresAt = new Date(Date.now() + OAUTH_SESSION_TTL_MINUTES * 60_000).toISOString()
    const { data: session, error } = await supabase
      .from('content_oauth_sessions')
      .insert({ org_id: unit.org_id, unit_id: unit.id, pages: enrichedPages, expires_at: expiresAt })
      .select('id')
      .single()
    if (error || !session) return fail('Conectamos com o Facebook, mas não conseguimos listar suas Páginas — tente de novo.')

    connectPageUrl.searchParams.set('oauth_session', session.id)
    return NextResponse.redirect(connectPageUrl)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha desconhecida no login com Facebook.'
    await logSystemEvent(supabase, {
      level: 'error',
      source: 'content',
      eventType: 'content_oauth_failed',
      message: `Login com Facebook falhou na unidade "${unit.id}": ${message}`,
      orgId: unit.org_id,
      unitId: unit.id,
    })
    return fail(translateIntegrationError('meta', message))
  }
}
