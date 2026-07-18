import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAppUser } from '@/lib/app-user'
import type { Unit } from '@/lib/types'

export const dynamic = 'force-dynamic'

/**
 * POST /api/customers — cadastro manual de cliente (módulo do AI
 * Receptionist). org_id é resolvido no servidor a partir da unidade
 * (RLS só devolve unidades que o usuário pode acessar) — nunca
 * confiado direto do corpo da requisição, mesma receita de /api/jobs.
 */
export async function POST(request: Request) {
  const appUser = await getAppUser()
  if (!appUser) {
    return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  }
  if (appUser.role === 'viewer') {
    return NextResponse.json({ error: 'Sem permissão para cadastrar clientes.' }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  const unitId: string | undefined = body?.unit_id
  const name: string | undefined = body?.name?.trim()

  if (!unitId || !name) {
    return NextResponse.json({ error: 'unit_id e name são obrigatórios.' }, { status: 400 })
  }

  const supabase = await createClient()

  const { data: unit } = await supabase.from('units').select('*').eq('id', unitId).maybeSingle()
  if (!unit) {
    return NextResponse.json({ error: 'Unidade não encontrada ou sem acesso.' }, { status: 404 })
  }
  const unitRow = unit as Unit
  if (!unitRow.org_id) {
    return NextResponse.json({ error: 'Unidade sem organização vinculada.' }, { status: 400 })
  }

  const tags: string[] = Array.isArray(body?.tags)
    ? body.tags.filter((t: unknown) => typeof t === 'string' && t.trim().length > 0)
    : []

  const { data: customer, error } = await supabase
    .from('customers')
    .insert({
      org_id: unitRow.org_id,
      unit_id: unitRow.id,
      name,
      phone: body?.phone?.trim() || null,
      email: body?.email?.trim() || null,
      address: body?.address?.trim() || null,
      city: body?.city?.trim() || null,
      tags,
      source: 'manual',
      notes: body?.notes?.trim() || null,
    })
    .select('*')
    .single()

  if (error || !customer) {
    return NextResponse.json(
      { error: `Não foi possível cadastrar o cliente: ${error?.message ?? 'erro desconhecido'}` },
      { status: 500 },
    )
  }

  return NextResponse.json({ customer })
}
