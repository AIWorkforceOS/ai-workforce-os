import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * Contas de anúncio do Traffic Specialist.
 * Sessão autenticada — o RLS garante o escopo por organização.
 *
 * GET  — lista as contas visíveis ao usuário
 * POST — conecta uma nova conta (credencial por conta é opcional na
 *        criação; sem ela a conta fica em 'pending_credentials')
 */
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  const { data, error } = await supabase
    .from('ad_accounts')
    .select('id, org_id, unit_id, platform, external_account_id, name, currency, connection_status, connection_error, optimization_mode, strategy, last_synced_at, is_active')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ accounts: data ?? [] })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  let body: {
    unit_id?: string
    platform?: string
    external_account_id?: string
    name?: string
    currency?: string
    access_token?: string
    refresh_token?: string
    optimization_mode?: string
    strategy?: Record<string, unknown>
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido.' }, { status: 400 })
  }

  if (!body.unit_id || !body.platform || !body.external_account_id || !body.name) {
    return NextResponse.json(
      { error: 'Campos obrigatórios: unit_id, platform, external_account_id, name.' },
      { status: 400 },
    )
  }
  if (body.platform !== 'meta' && body.platform !== 'google') {
    return NextResponse.json({ error: "platform deve ser 'meta' ou 'google'." }, { status: 400 })
  }
  if (body.optimization_mode && !['suggestion', 'autonomous'].includes(body.optimization_mode)) {
    return NextResponse.json(
      { error: "optimization_mode deve ser 'suggestion' ou 'autonomous'." },
      { status: 400 },
    )
  }

  // Resolve a org da unidade (o RLS já barra unidades de outra org)
  const { data: unit } = await supabase
    .from('units')
    .select('id, org_id')
    .eq('id', body.unit_id)
    .single()
  if (!unit?.org_id) {
    return NextResponse.json({ error: 'Unidade não encontrada.' }, { status: 404 })
  }

  const hasCredentials = Boolean(body.access_token || body.refresh_token)

  const { data, error } = await supabase
    .from('ad_accounts')
    .insert({
      org_id: unit.org_id,
      unit_id: body.unit_id,
      platform: body.platform,
      external_account_id: body.external_account_id.trim(),
      name: body.name.trim(),
      currency: body.currency ?? 'BRL',
      access_token: body.access_token ?? null,
      refresh_token: body.refresh_token ?? null,
      connection_status: hasCredentials ? 'connected' : 'pending_credentials',
      // Segurança: toda conta nasce em modo sugestão; autonomia é opt-in
      // consciente e pode ser alterada depois via PATCH/painel.
      optimization_mode: body.optimization_mode ?? 'suggestion',
      strategy: body.strategy ?? {},
    })
    .select('id, platform, name, connection_status, optimization_mode')
    .single()

  if (error) {
    const status = error.code === '23505' ? 409 : 500
    return NextResponse.json(
      { error: status === 409 ? 'Esta conta já está conectada nesta unidade.' : error.message },
      { status },
    )
  }
  return NextResponse.json({ account: data }, { status: 201 })
}
