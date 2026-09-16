import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { fetchOrganizationFacilitEnabled } from '@/lib/organizations'

export const dynamic = 'force-dynamic'

/**
 * Client Code/Login/Password da Facil-IT pra essa unidade (integração
 * Mawi Pro, 2026-09-10). Client de sessão normal, não service role — a
 * policy facilit_credentials_write já exige is_org_admin(), então só o
 * dono da conta consegue salvar/trocar a senha, e a policy _select nunca
 * devolve a senha de volta pro navegador de ninguém (ver GET abaixo:
 * seleciona só os campos não sensíveis).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  }

  const { data: unit } = await supabase.from('units').select('org_id').eq('id', id).single()
  const facilitEnabled = await fetchOrganizationFacilitEnabled(supabase, unit?.org_id)
  if (!facilitEnabled) {
    return NextResponse.json({ error: 'Integração não disponível para esta unidade.' }, { status: 404 })
  }

  const { data } = await supabase
    .from('facilit_credentials')
    .select('client_code, username, is_active, last_synced_at, last_sync_error')
    .eq('unit_id', id)
    .maybeSingle()

  return NextResponse.json({ credential: data ?? null })
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  }

  const { data: unit } = await supabase.from('units').select('id, org_id').eq('id', id).single()
  if (!unit?.org_id) {
    return NextResponse.json({ error: 'Unidade não encontrada.' }, { status: 404 })
  }
  const facilitEnabled = await fetchOrganizationFacilitEnabled(supabase, unit.org_id)
  if (!facilitEnabled) {
    return NextResponse.json({ error: 'Integração não disponível para esta unidade.' }, { status: 404 })
  }

  const body = await request.json().catch(() => null)
  const clientCode = typeof body?.clientCode === 'string' ? body.clientCode.trim() : ''
  const username = typeof body?.username === 'string' ? body.username.trim() : ''
  const password = typeof body?.password === 'string' ? body.password : ''
  if (!clientCode || !username || !password) {
    return NextResponse.json({ error: 'Client Code, usuário e senha são obrigatórios.' }, { status: 400 })
  }

  const { error } = await supabase.from('facilit_credentials').upsert(
    {
      org_id: unit.org_id,
      unit_id: id,
      client_code: clientCode,
      username,
      password,
      is_active: true,
      last_sync_error: null,
    },
    { onConflict: 'unit_id' },
  )

  if (error) {
    return NextResponse.json({ error: 'Não foi possível salvar. Verifique se você tem acesso a esta unidade.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
