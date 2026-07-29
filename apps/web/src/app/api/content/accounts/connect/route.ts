import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logSystemEvent } from '@/lib/system-events'
import { testSocialConnection } from '@/lib/content/connection-test'

/**
 * Conexão self-service de uma Página do Facebook (+ Instagram vinculado)
 * pelo próprio cliente — mesma receita de /api/traffic/accounts/connect:
 * SEMPRE testamos a credencial com uma chamada real na Graph API antes
 * de gravar em social_accounts.
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  let body: { unit_id?: string; page_id?: string; page_access_token?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido.' }, { status: 400 })
  }

  const pageId = body.page_id?.trim()
  if (!body.unit_id || !pageId) {
    return NextResponse.json({ error: 'Campos obrigatórios: unit_id, page_id.' }, { status: 400 })
  }

  const { data: unit } = await supabase.from('units').select('id, org_id').eq('id', body.unit_id).single()
  if (!unit?.org_id) {
    return NextResponse.json({ error: 'Unidade não encontrada.' }, { status: 404 })
  }

  const test = await testSocialConnection({ pageId, pageAccessToken: body.page_access_token })
  if (!test.ok) {
    await logSystemEvent(supabase, {
      level: 'warning',
      source: 'content',
      eventType: 'content_self_serve_connect_failed',
      message: `Conexão self-service falhou (Página ${pageId}): ${test.rawError}`,
      orgId: unit.org_id,
      unitId: body.unit_id,
    })
    return NextResponse.json({ error: test.error }, { status: 422 })
  }

  const { data, error } = await supabase
    .from('social_accounts')
    .upsert(
      {
        org_id: unit.org_id,
        unit_id: body.unit_id,
        platform: 'meta',
        page_id: pageId,
        page_name: test.label,
        page_access_token: body.page_access_token?.trim() || null,
        instagram_business_account_id: test.instagramBusinessAccountId,
        instagram_username: test.instagramUsername,
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

  await logSystemEvent(supabase, {
    level: 'info',
    source: 'content',
    eventType: 'content_self_serve_connected',
    message: `Cliente conectou a Página "${test.label}" via self-service.`,
    orgId: unit.org_id,
    unitId: body.unit_id,
  })

  return NextResponse.json({ account: data, label: test.label }, { status: 200 })
}
