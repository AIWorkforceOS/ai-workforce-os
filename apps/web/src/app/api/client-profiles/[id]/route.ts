import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireClientProfileAdmin } from '@/lib/client-profiles/auth'
import { updateClientProfileSchema } from '@/lib/client-profiles/schema'
import { CLIENT_PROFILE_EDIT_COLUMNS } from '@/lib/client-profiles/profile'
import { createServiceClient } from '@/lib/supabase/service'
import { renameClientEverywhere } from '@/lib/client-profiles/rename'

export const dynamic = 'force-dynamic'

/** Edita os dados do cliente, inclusive o nome (que atualiza ordens e logins do portal). A RLS garante que só o administrador da MESMA empresa altera. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireClientProfileAdmin()
  if (!auth.ok) return auth.response
  const { id } = await params
  const parsed = updateClientProfileSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Dados inválidos.' }, { status: 400 })
  const supabase = await createClient()
  const { name, ...fields } = parsed.data

  // Renomear: primeiro confere (com a sessão do usuário) que o cliente é da empresa dele, depois atualiza tudo que usa o nome como vínculo.
  if (name !== undefined) {
    const { data: current } = await supabase.from('client_company_profiles').select('id, org_id, name').eq('id', id).maybeSingle()
    const row = current as { id: string; org_id: string; name: string } | null
    if (!row) return NextResponse.json({ error: 'Cliente não encontrado.' }, { status: 404 })
    const service = createServiceClient()
    if (!service) return NextResponse.json({ error: 'Servidor sem acesso de gravação configurado.' }, { status: 500 })
    const renamed = await renameClientEverywhere(service, { profileId: row.id, orgId: row.org_id, oldName: row.name, newName: name })
    if (!renamed.ok) return NextResponse.json({ error: renamed.error }, { status: renamed.status })
  }

  if (Object.keys(fields).length === 0) {
    const { data: unchanged } = await supabase.from('client_company_profiles').select(CLIENT_PROFILE_EDIT_COLUMNS).eq('id', id).maybeSingle()
    return unchanged ? NextResponse.json({ profile: unchanged }) : NextResponse.json({ error: 'Cliente não encontrado.' }, { status: 404 })
  }
  const { data, error } = await supabase.from('client_company_profiles').update(fields).eq('id', id).select(CLIENT_PROFILE_EDIT_COLUMNS).maybeSingle()
  if (error) return NextResponse.json({ error: 'Não foi possível salvar.' }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Cliente não encontrado.' }, { status: 404 })
  return NextResponse.json({ profile: data })
}
