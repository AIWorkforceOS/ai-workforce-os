import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logSystemEvent } from '@/lib/system-events'
import {
  exchangeCodeForTokens,
  getGoogleSearchConsoleCredentials,
  listVerifiedSites,
  verifyOAuthState,
  GSC_OAUTH_SESSION_TTL_MINUTES,
} from '@/lib/seo/search-console-oauth'

/**
 * Volta do login com Google: troca o code por tokens, lista as propriedades
 * do Search Console que essa conta pode consultar e ou já conecta (1
 * propriedade) ou grava uma sessão temporária pra escolha (mais de uma) —
 * ver lib/seo/search-console-oauth.ts pro fluxo completo. Mesmo padrão de
 * api/content/accounts/oauth/callback.
 */
export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const seoPageUrl = new URL('/dashboard/seo', requestUrl.origin)

  function fail(message: string) {
    seoPageUrl.searchParams.set('oauth_error', message)
    return NextResponse.redirect(seoPageUrl)
  }

  const oauthError = requestUrl.searchParams.get('error_description') ?? requestUrl.searchParams.get('error')
  if (oauthError) return fail('Não foi possível concluir o login com o Google — a autorização não foi concedida.')

  const code = requestUrl.searchParams.get('code')
  const state = requestUrl.searchParams.get('state')
  if (!code || !state) return fail('Resposta inválida do Google — tente conectar novamente.')

  const credentials = getGoogleSearchConsoleCredentials()
  if (!credentials) return fail('A conexão com o Google Search Console ainda não está disponível — o time da Alizo precisa configurar as credenciais do Google primeiro.')

  const verified = verifyOAuthState(state, credentials.clientSecret)
  if (!verified) return fail('Sessão de login expirada ou inválida — tente conectar de novo.')

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(new URL('/login', requestUrl.origin))

  const { data: unit } = await supabase.from('units').select('id, org_id').eq('id', verified.unitId).maybeSingle()
  if (!unit?.org_id) return fail('Unidade não encontrada ou sem permissão.')

  const redirectUri = new URL('/api/seo/gsc/oauth/callback', requestUrl.origin).toString()

  try {
    const { accessToken, refreshToken, expiresInSeconds } = await exchangeCodeForTokens({
      code,
      redirectUri,
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
    })

    const siteUrls = await listVerifiedSites(accessToken)
    if (siteUrls.length === 0) {
      return fail(
        'Nenhuma propriedade verificada foi encontrada nessa conta do Google Search Console — confirme que o site já está verificado em search.google.com/search-console e tente de novo.',
      )
    }

    const tokenExpiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString()

    if (siteUrls.length === 1) {
      const { error } = await supabase.from('seo_search_console_accounts').upsert(
        {
          org_id: unit.org_id,
          unit_id: unit.id,
          site_url: siteUrls[0],
          refresh_token: refreshToken,
          access_token: accessToken,
          token_expires_at: tokenExpiresAt,
          connection_status: 'connected',
          connection_error: null,
        },
        { onConflict: 'unit_id' },
      )
      if (error) return fail('Conectamos com o Google, mas não conseguimos salvar a propriedade — tente de novo.')

      await logSystemEvent(supabase, {
        level: 'info',
        source: 'seo',
        eventType: 'seo_gsc_connected',
        message: `Cliente conectou a propriedade "${siteUrls[0]}" do Search Console.`,
        orgId: unit.org_id,
        unitId: unit.id,
      })

      seoPageUrl.searchParams.set('oauth_success', siteUrls[0]!)
      return NextResponse.redirect(seoPageUrl)
    }

    // Mais de uma propriedade — grava as candidatas e deixa o cliente escolher.
    const expiresAt = new Date(Date.now() + GSC_OAUTH_SESSION_TTL_MINUTES * 60_000).toISOString()
    const { data: session, error } = await supabase
      .from('seo_gsc_oauth_sessions')
      .insert({ org_id: unit.org_id, unit_id: unit.id, site_urls: siteUrls, refresh_token: refreshToken, access_token: accessToken, expires_at: expiresAt })
      .select('id')
      .single()
    if (error || !session) return fail('Conectamos com o Google, mas não conseguimos listar suas propriedades — tente de novo.')

    seoPageUrl.searchParams.set('oauth_session', session.id)
    return NextResponse.redirect(seoPageUrl)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha desconhecida no login com o Google.'
    await logSystemEvent(supabase, {
      level: 'error',
      source: 'seo',
      eventType: 'seo_gsc_oauth_failed',
      message: `Login com Google Search Console falhou na unidade "${unit.id}": ${message}`,
      orgId: unit.org_id,
      unitId: unit.id,
    })
    return fail(message)
  }
}
