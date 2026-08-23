import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logSystemEvent } from '@/lib/system-events'
import type { SeoGscOAuthSession } from '@/lib/seo/types'

/**
 * Passo final de escolha de propriedade (só chamado quando a conta Google
 * tem mais de uma verificada — ver callback/route.ts): grava a propriedade
 * escolhida em seo_search_console_accounts e apaga a sessão temporária.
 * Mesmo padrão de api/content/accounts/oauth/finalize.
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  let body: { oauth_session_id?: string; site_url?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido.' }, { status: 400 })
  }
  if (!body.oauth_session_id || !body.site_url) {
    return NextResponse.json({ error: 'Campos obrigatórios: oauth_session_id, site_url.' }, { status: 400 })
  }

  const { data: session } = await supabase
    .from('seo_gsc_oauth_sessions')
    .select('*')
    .eq('id', body.oauth_session_id)
    .maybeSingle()
  const sessionRow = session as SeoGscOAuthSession | null
  if (!sessionRow) {
    return NextResponse.json({ error: 'Sessão de login não encontrada, expirada ou sem permissão.' }, { status: 404 })
  }
  if (new Date(sessionRow.expires_at).getTime() < Date.now()) {
    await supabase.from('seo_gsc_oauth_sessions').delete().eq('id', sessionRow.id)
    return NextResponse.json({ error: 'Essa lista de propriedades expirou — conecte com o Google de novo.' }, { status: 410 })
  }

  if (!sessionRow.site_urls.includes(body.site_url)) {
    return NextResponse.json({ error: 'Propriedade não encontrada nessa sessão de login.' }, { status: 404 })
  }

  const { data: account, error } = await supabase
    .from('seo_search_console_accounts')
    .upsert(
      {
        org_id: sessionRow.org_id,
        unit_id: sessionRow.unit_id,
        site_url: body.site_url,
        refresh_token: sessionRow.refresh_token,
        access_token: sessionRow.access_token,
        token_expires_at: sessionRow.expires_at,
        connection_status: 'connected',
        connection_error: null,
      },
      { onConflict: 'unit_id' },
    )
    .select('id, site_url, connection_status')
    .single()

  if (error) {
    const isPermissionError = error.code === '42501'
    return NextResponse.json(
      { error: isPermissionError ? 'Só administradores da organização podem conectar contas do Search Console.' : error.message },
      { status: isPermissionError ? 403 : 500 },
    )
  }

  await supabase.from('seo_gsc_oauth_sessions').delete().eq('id', sessionRow.id)

  await logSystemEvent(supabase, {
    level: 'info',
    source: 'seo',
    eventType: 'seo_gsc_connected',
    message: `Cliente escolheu e conectou a propriedade "${body.site_url}" do Search Console.`,
    orgId: sessionRow.org_id,
    unitId: sessionRow.unit_id,
  })

  return NextResponse.json({ account, label: body.site_url })
}
