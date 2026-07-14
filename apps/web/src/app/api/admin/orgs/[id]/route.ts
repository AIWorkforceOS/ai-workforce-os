import { NextResponse } from 'next/server'
import { getAppUser } from '@/lib/app-user'
import { createClient } from '@/lib/supabase/server'

/**
 * PATCH /api/admin/orgs/[id] — ativa/desativa uma empresa cliente
 * (apenas super_admin; a escrita passa pelo RLS da sessão).
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const appUser = await getAppUser()
  if (!appUser?.isSuperAdmin) {
    return NextResponse.json({ error: 'Apenas super admin pode alterar empresas.' }, { status: 403 })
  }

  const { id } = await params
  const body = await request.json().catch(() => null)
  if (typeof body?.is_active !== 'boolean') {
    return NextResponse.json({ error: 'is_active (boolean) é obrigatório.' }, { status: 400 })
  }

  const supabase = await createClient()
  const { error } = await supabase.from('organizations').update({ is_active: body.is_active }).eq('id', id)
  if (error) {
    return NextResponse.json({ error: `Erro ao atualizar: ${error.message}` }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
