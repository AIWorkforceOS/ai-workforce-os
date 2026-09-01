import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logSystemEvent } from '@/lib/system-events'
import { translateIntegrationError } from '@/lib/integration-errors'
import { exchangeCodeForUserToken, exchangeForLongLivedToken, verifyOAuthState } from '@/lib/content/meta-oauth'
import { getMetaAdsAppCredentials, listManagedAdAccounts } from '@/lib/traffic/meta-ads-oauth'

/**
 * Volta do login com Facebook pro Tráfego Pago: troca o code por token,
 * lista as contas de anúncio do usuário e ou já conecta (1 conta) ou grava
 * uma sessão temporária pra escolha (mais de uma) — mesmo desenho do
 * fluxo de Página (api/content/accounts/oauth/callback/route.ts), ver
 * lib/traffic/meta-ads-oauth.ts pra diferença sobre o token não ser por
 * conta.
 */
export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const connectPageUrl = new URL('/dashboard/traffic/connect', requestUrl.origin)

  function fail(message: string) {
    connectPageUrl.searchParams.set('oauth_error', message)
    return NextResponse.redirect(connectPageUrl)
  }

  const oauthError = requestUrl.searchParams.get('error_description') ?? requestUrl.searchParams.get('error')
  if (oauthError) return fail('Não foi possível concluir o login com Facebook — a autorização não foi concedida.')

  const code = requestUrl.searchParams.get('code')
  const state = requestUrl.searchParams.get('state')
  if (!code || !state) return fail('Resposta inválida do Facebook — tente conectar novamente.')

  const credentials = getMetaAdsAppCredentials()
  if (!credentials) return fail('O login com Facebook pra anúncios ainda não está disponível — o time da Alizo precisa configurar o app da Meta primeiro.')

  const verified = verifyOAuthState(state, credentials.appSecret)
  if (!verified) return fail('Sessão de login expirada ou inválida — tente conectar de novo.')

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(new URL('/login', requestUrl.origin))

  const { data: unit } = await supabase.from('units').select('id, org_id').eq('id', verified.unitId).maybeSingle()
  if (!unit?.org_id) return fail('Unidade não encontrada ou sem permissão.')

  const redirectUri = new URL('/api/traffic/accounts/oauth/callback', requestUrl.origin).toString()

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

    const accounts = await listManagedAdAccounts(longLivedToken)
    if (accounts.length === 0) {
      return fail(
        'Nenhuma conta de anúncio encontrada nessa conta do Facebook — confirme que você administra pelo menos uma conta de anúncio e tente de novo.',
      )
    }

    if (accounts.length === 1) {
      const account = accounts[0]!
      const { error } = await supabase.from('ad_accounts').upsert(
        {
          org_id: unit.org_id,
          unit_id: unit.id,
          platform: 'meta',
          external_account_id: account.id,
          name: account.name,
          currency: account.currency,
          access_token: longLivedToken,
          connection_status: 'connected',
          connection_error: null,
        },
        { onConflict: 'unit_id,platform,external_account_id' },
      )
      if (error) return fail('Conectamos com o Facebook, mas não conseguimos salvar a conta de anúncio — tente de novo.')

      await logSystemEvent(supabase, {
        level: 'info',
        source: 'meta_ads',
        eventType: 'traffic_oauth_connected',
        message: `Cliente conectou a conta de anúncio "${account.name}" via login com Facebook.`,
        orgId: unit.org_id,
        unitId: unit.id,
      })

      connectPageUrl.searchParams.set('oauth_success', account.name)
      return NextResponse.redirect(connectPageUrl)
    }

    // Mais de uma conta — grava as candidatas (+ o token, compartilhado
    // entre todas) e deixa o cliente escolher.
    const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString()
    const { data: session, error } = await supabase
      .from('traffic_oauth_sessions')
      .insert({ org_id: unit.org_id, unit_id: unit.id, access_token: longLivedToken, accounts, expires_at: expiresAt })
      .select('id')
      .single()
    if (error || !session) return fail('Conectamos com o Facebook, mas não conseguimos listar suas contas de anúncio — tente de novo.')

    connectPageUrl.searchParams.set('oauth_session', session.id)
    return NextResponse.redirect(connectPageUrl)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha desconhecida no login com Facebook.'
    await logSystemEvent(supabase, {
      level: 'error',
      source: 'meta_ads',
      eventType: 'traffic_oauth_failed',
      message: `Login com Facebook (anúncios) falhou na unidade "${unit.id}": ${message}`,
      orgId: unit.org_id,
      unitId: unit.id,
    })
    return fail(translateIntegrationError('meta', message))
  }
}
