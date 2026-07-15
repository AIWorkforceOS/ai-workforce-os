import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logSystemEvent } from '@/lib/system-events'
import { testGoogleAdsConnection, testMetaConnection } from '@/lib/traffic/connection-test'

/**
 * Conexão self-service de uma conta de anúncio pelo próprio cliente.
 * Diferente de POST /api/traffic/accounts (usado pela equipe Alizo com
 * credenciais já conferidas), aqui SEMPRE testamos a credencial com uma
 * chamada real na plataforma antes de gravar — o cliente precisa saber
 * na hora se funcionou ou não.
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  let body: {
    unit_id?: string
    platform?: string
    external_account_id?: string
    name?: string
    access_token?: string
    refresh_token?: string
    google_developer_token?: string
    google_client_id?: string
    google_client_secret?: string
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido.' }, { status: 400 })
  }

  const platform = body.platform
  const externalAccountId = body.external_account_id?.trim()
  if (!body.unit_id || !platform || !externalAccountId) {
    return NextResponse.json(
      { error: 'Campos obrigatórios: unit_id, platform, external_account_id.' },
      { status: 400 },
    )
  }
  if (platform !== 'meta' && platform !== 'google') {
    return NextResponse.json({ error: "platform deve ser 'meta' ou 'google'." }, { status: 400 })
  }

  const { data: unit } = await supabase
    .from('units')
    .select('id, org_id')
    .eq('id', body.unit_id)
    .single()
  if (!unit?.org_id) {
    return NextResponse.json({ error: 'Unidade não encontrada.' }, { status: 404 })
  }

  const test =
    platform === 'meta'
      ? await testMetaConnection({ externalAccountId, accessToken: body.access_token })
      : await testGoogleAdsConnection({
          externalAccountId,
          refreshToken: body.refresh_token,
          developerToken: body.google_developer_token,
          clientId: body.google_client_id,
          clientSecret: body.google_client_secret,
        })

  if (!test.ok) {
    await logSystemEvent(supabase, {
      level: 'warning',
      source: platform === 'meta' ? 'meta_ads' : 'google_ads',
      eventType: 'traffic_self_serve_connect_failed',
      message: `Conexão self-service falhou (${platform}, conta ${externalAccountId}): ${test.error}`,
      orgId: unit.org_id,
      unitId: body.unit_id,
    })
    return NextResponse.json({ error: test.error }, { status: 422 })
  }

  const credentials =
    platform === 'meta'
      ? { access_token: body.access_token?.trim() || null, refresh_token: null }
      : {
          refresh_token: body.refresh_token?.trim() || null,
          google_developer_token: body.google_developer_token?.trim() || null,
          google_client_id: body.google_client_id?.trim() || null,
          google_client_secret: body.google_client_secret?.trim() || null,
        }

  const { data, error } = await supabase
    .from('ad_accounts')
    .upsert(
      {
        org_id: unit.org_id,
        unit_id: body.unit_id,
        platform,
        external_account_id: externalAccountId,
        name: body.name?.trim() || test.label,
        ...credentials,
        connection_status: 'connected',
        connection_error: null,
      },
      { onConflict: 'unit_id,platform,external_account_id' },
    )
    .select('id, platform, name, connection_status, optimization_mode')
    .single()

  if (error) {
    const isPermissionError = error.code === '42501'
    return NextResponse.json(
      { error: isPermissionError ? 'Só administradores da organização podem conectar contas de anúncio.' : error.message },
      { status: isPermissionError ? 403 : 500 },
    )
  }

  await logSystemEvent(supabase, {
    level: 'info',
    source: platform === 'meta' ? 'meta_ads' : 'google_ads',
    eventType: 'traffic_self_serve_connected',
    message: `Cliente conectou a conta "${test.label}" (${platform}) via self-service.`,
    orgId: unit.org_id,
    unitId: body.unit_id,
  })

  return NextResponse.json({ account: data, label: test.label }, { status: 200 })
}
