import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAppUser } from '@/lib/app-user'
import { createServiceClient } from '@/lib/supabase/service'
import { assignableJobRole } from '@/lib/permissions/job-roles'
import { canEditTargetAccess, canManageUserAccess } from '@/lib/permissions/user-access'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  userId: z.string().uuid(),
  // 'admin' = administrador completo; financeiro | comercial | operacional = função restrita; 'viewer' = só visualização
  access: z.enum(['admin', 'financeiro', 'comercial', 'operacional', 'viewer']).optional(),
  active: z.boolean().optional(),
})

/**
 * Altera a função de acesso (e ativa/desativa) de um usuário de escritório. Só super admin ou administrador completo da empresa; nunca o próprio
 * acesso. O banco também protege as colunas: nenhum usuário altera job_role/role/is_active de si mesmo (trava 099); a escrita só acontece aqui,
 * depois de a regra acima ser checada, com a chave de serviço.
 */
export async function PATCH(request: Request) {
  const actor = await getAppUser()
  if (!actor) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  if (!canManageUserAccess(actor)) return NextResponse.json({ error: 'Somente o administrador da empresa gerencia usuários e funções.' }, { status: 403 })

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success || (parsed.data.access === undefined && parsed.data.active === undefined)) return NextResponse.json({ error: 'Dados inválidos.' }, { status: 400 })

  const service = createServiceClient()
  if (!service) return NextResponse.json({ error: 'Servidor sem acesso de gravação configurado.' }, { status: 500 })
  const { data } = await service.from('users').select('id, role, org_id').eq('id', parsed.data.userId).maybeSingle()
  const target = data as { id: string; role: string; org_id: string | null } | null
  if (!target) return NextResponse.json({ error: 'Usuário não encontrado.' }, { status: 404 })
  const allowed = canEditTargetAccess(actor, { id: target.id, role: target.role, orgId: target.org_id })
  if (!allowed.ok) return NextResponse.json({ error: allowed.error }, { status: 403 })

  const patch: Record<string, unknown> = {}
  if (parsed.data.access !== undefined) {
    if (parsed.data.access === 'viewer') Object.assign(patch, { role: 'viewer', job_role: null })
    else Object.assign(patch, { role: 'admin', job_role: assignableJobRole(parsed.data.access) })
  }
  if (parsed.data.active !== undefined) patch.is_active = parsed.data.active

  const { error } = await service.from('users').update(patch).eq('id', target.id)
  if (error) return NextResponse.json({ error: 'Não foi possível salvar. Tente de novo.' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
