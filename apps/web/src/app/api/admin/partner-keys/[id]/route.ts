import { NextResponse } from 'next/server'
import { getAppUser } from '@/lib/app-user'
import { createServiceClient } from '@/lib/supabase/service'
import { canManageUserAccess } from '@/lib/permissions/user-access'

export const dynamic = 'force-dynamic'

/** DELETE /api/admin/partner-keys/{id} — revoga a chave (imediato; não apaga o histórico). */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getAppUser()
  if (!actor) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  if (!canManageUserAccess(actor)) {
    return NextResponse.json({ error: 'Somente o administrador da empresa gerencia chaves de API.' }, { status: 403 })
  }

  const { id } = await params
  const service = createServiceClient()
  if (!service) return NextResponse.json({ error: 'Servidor sem acesso de gravação configurado.' }, { status: 500 })

  const { data } = await service.from('partner_api_keys').select('id, org_id, unit_id').eq('id', id).maybeSingle()
  const key = data as { id: string; org_id: string; unit_id: string | null } | null
  if (!key || (!actor.isSuperAdmin && (key.org_id !== actor.orgId || (actor.unitId && key.unit_id !== actor.unitId)))) {
    return NextResponse.json({ error: 'Chave não encontrada.' }, { status: 404 })
  }

  const { error } = await service
    .from('partner_api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', key.id)
  if (error) return NextResponse.json({ error: 'Não foi possível revogar a chave.' }, { status: 500 })

  return NextResponse.json({ ok: true })
}
