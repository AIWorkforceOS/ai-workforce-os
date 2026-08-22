import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logSystemEvent } from '@/lib/system-events'
import type { ContentOAuthSession } from '@/lib/content/types'

/**
 * Passo final de escolha de Página (só chamado quando o cliente administra
 * mais de uma — ver callback/route.ts): grava a Página escolhida em
 * social_accounts e apaga a sessão temporária.
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  let body: { oauth_session_id?: string; page_id?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido.' }, { status: 400 })
  }
  if (!body.oauth_session_id || !body.page_id) {
    return NextResponse.json({ error: 'Campos obrigatórios: oauth_session_id, page_id.' }, { status: 400 })
  }

  const { data: session } = await supabase
    .from('content_oauth_sessions')
    .select('*')
    .eq('id', body.oauth_session_id)
    .maybeSingle()
  const sessionRow = session as ContentOAuthSession | null
  if (!sessionRow) {
    return NextResponse.json({ error: 'Sessão de login não encontrada, expirada ou sem permissão.' }, { status: 404 })
  }
  if (new Date(sessionRow.expires_at).getTime() < Date.now()) {
    await supabase.from('content_oauth_sessions').delete().eq('id', sessionRow.id)
    return NextResponse.json({ error: 'Essa lista de Páginas expirou — conecte com o Facebook de novo.' }, { status: 410 })
  }

  const chosen = sessionRow.pages.find((page) => page.id === body.page_id)
  if (!chosen) {
    return NextResponse.json({ error: 'Página não encontrada nessa sessão de login.' }, { status: 404 })
  }

  const { data: account, error } = await supabase
    .from('social_accounts')
    .upsert(
      {
        org_id: sessionRow.org_id,
        unit_id: sessionRow.unit_id,
        platform: 'meta',
        page_id: chosen.id,
        page_name: chosen.name,
        page_access_token: chosen.access_token,
        instagram_business_account_id: chosen.instagram_business_account_id,
        instagram_username: chosen.instagram_username,
        connection_status: 'connected',
        connection_error: null,
      },
      { onConflict: 'unit_id,page_id' },
    )
    .select('id, page_name, connection_status, publishing_mode, instagram_username')
    .single()

  if (error) {
    const isPermissionError = error.code === '42501'
    return NextResponse.json(
      { error: isPermissionError ? 'Só administradores da organização podem conectar contas de rede social.' : error.message },
      { status: isPermissionError ? 403 : 500 },
    )
  }

  await supabase.from('content_oauth_sessions').delete().eq('id', sessionRow.id)

  await logSystemEvent(supabase, {
    level: 'info',
    source: 'content',
    eventType: 'content_oauth_connected',
    message: `Cliente escolheu e conectou a Página "${chosen.name}" via login com Facebook.`,
    orgId: sessionRow.org_id,
    unitId: sessionRow.unit_id,
  })

  return NextResponse.json({ account, label: chosen.name })
}
