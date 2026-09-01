import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logSystemEvent } from '@/lib/system-events'
import type { TrafficOAuthSession } from '@/lib/traffic/types'

/**
 * Passo final de escolha de conta de anúncio (só chamado quando o cliente
 * administra mais de uma — ver callback/route.ts): grava a conta escolhida
 * em ad_accounts com o token guardado na sessão (o mesmo token serve pra
 * qualquer uma das candidatas) e apaga a sessão temporária.
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  let body: { oauth_session_id?: string; account_id?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido.' }, { status: 400 })
  }
  if (!body.oauth_session_id || !body.account_id) {
    return NextResponse.json({ error: 'Campos obrigatórios: oauth_session_id, account_id.' }, { status: 400 })
  }

  const { data: session } = await supabase
    .from('traffic_oauth_sessions')
    .select('*')
    .eq('id', body.oauth_session_id)
    .maybeSingle()
  const sessionRow = session as TrafficOAuthSession | null
  if (!sessionRow) {
    return NextResponse.json({ error: 'Sessão de login não encontrada, expirada ou sem permissão.' }, { status: 404 })
  }
  if (new Date(sessionRow.expires_at).getTime() < Date.now()) {
    await supabase.from('traffic_oauth_sessions').delete().eq('id', sessionRow.id)
    return NextResponse.json({ error: 'Essa lista de contas expirou — conecte com o Facebook de novo.' }, { status: 410 })
  }

  const chosen = sessionRow.accounts.find((account) => account.id === body.account_id)
  if (!chosen) {
    return NextResponse.json({ error: 'Conta de anúncio não encontrada nessa sessão de login.' }, { status: 404 })
  }

  const { data: account, error } = await supabase
    .from('ad_accounts')
    .upsert(
      {
        org_id: sessionRow.org_id,
        unit_id: sessionRow.unit_id,
        platform: 'meta',
        external_account_id: chosen.id,
        name: chosen.name,
        currency: chosen.currency,
        access_token: sessionRow.access_token,
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

  await supabase.from('traffic_oauth_sessions').delete().eq('id', sessionRow.id)

  await logSystemEvent(supabase, {
    level: 'info',
    source: 'meta_ads',
    eventType: 'traffic_oauth_connected',
    message: `Cliente escolheu e conectou a conta de anúncio "${chosen.name}" via login com Facebook.`,
    orgId: sessionRow.org_id,
    unitId: sessionRow.unit_id,
  })

  return NextResponse.json({ account, label: chosen.name })
}
