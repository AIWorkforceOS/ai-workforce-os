import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * PATCH { publishing_mode: 'suggestion' | 'autonomous' } — troca o modo
 * de publicação da conta (fila de aprovação × posta sozinho). Update via
 * sessão: o RLS (can_access_unit + is_org_admin) garante que só admin da
 * organização consegue mudar.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  let body: { publishing_mode?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido.' }, { status: 400 })
  }
  if (body.publishing_mode !== 'suggestion' && body.publishing_mode !== 'autonomous') {
    return NextResponse.json({ error: "publishing_mode deve ser 'suggestion' ou 'autonomous'." }, { status: 400 })
  }

  const { data: updated, error } = await supabase
    .from('social_accounts')
    .update({ publishing_mode: body.publishing_mode })
    .eq('id', id)
    .select('id, publishing_mode')
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!updated) return NextResponse.json({ error: 'Conta não encontrada ou sem permissão.' }, { status: 404 })

  return NextResponse.json({ account: updated })
}
