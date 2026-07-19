import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAppUser } from '@/lib/app-user'

export const dynamic = 'force-dynamic'

const EDITABLE_FIELDS = ['name', 'phone', 'email', 'address', 'city', 'status', 'tags', 'notes', 'custom_fields'] as const

/**
 * PATCH /api/customers/[id] — edição de um cliente já cadastrado
 * (status, tags, observações e dados de contato). RLS (via sessão)
 * já garante que só quem tem acesso à unidade do cliente edita.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const appUser = await getAppUser()
  if (!appUser) {
    return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  }
  if (appUser.role === 'viewer') {
    return NextResponse.json({ error: 'Sem permissão para editar clientes.' }, { status: 403 })
  }

  const { id } = await params
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Corpo da requisição inválido.' }, { status: 400 })
  }

  if (body.status !== undefined && body.status !== 'active' && body.status !== 'inactive') {
    return NextResponse.json({ error: 'status inválido.' }, { status: 400 })
  }

  const update: Record<string, unknown> = {}
  for (const field of EDITABLE_FIELDS) {
    if (body[field] === undefined) continue
    if (field === 'tags') {
      update.tags = Array.isArray(body.tags)
        ? body.tags.filter((t: unknown) => typeof t === 'string' && t.trim().length > 0)
        : []
      continue
    }
    if (field === 'custom_fields') {
      update.custom_fields =
        body.custom_fields && typeof body.custom_fields === 'object' && !Array.isArray(body.custom_fields)
          ? body.custom_fields
          : {}
      continue
    }
    update[field] = typeof body[field] === 'string' ? body[field].trim() || null : body[field]
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'Nada para atualizar.' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: customer, error } = await supabase
    .from('customers')
    .update(update)
    .eq('id', id)
    .select('*')
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: `Não foi possível salvar: ${error.message}` }, { status: 500 })
  }
  if (!customer) {
    return NextResponse.json({ error: 'Cliente não encontrado ou sem acesso.' }, { status: 404 })
  }

  return NextResponse.json({ customer })
}
