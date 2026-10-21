import { NextResponse } from 'next/server'
import { getAppUser } from '@/lib/app-user'
import { createServiceClient } from '@/lib/supabase/service'
import { canGrantBrandingAccess, canReceiveBrandingAccess } from '@/lib/branding/permissions'

export const dynamic = 'force-dynamic'

/**
 * Libera (ou retira) o direito de um ADMIN trocar a logo da própria empresa. SOMENTE o super admin Alizo.
 * O banco também protege a coluna: nenhum outro usuário consegue alterá-la mesmo chamando a API do Supabase diretamente (migration 099).
 */
export async function PATCH(request: Request) {
  const appUser = await getAppUser()
  if (!appUser) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  if (!canGrantBrandingAccess(appUser)) return NextResponse.json({ error: 'Somente a equipe Alizo pode liberar este acesso.' }, { status: 403 })

  const body = (await request.json().catch(() => null)) as { userId?: unknown; enabled?: unknown } | null
  if (typeof body?.userId !== 'string' || typeof body.enabled !== 'boolean') return NextResponse.json({ error: 'Informe o usuário e se o acesso fica ligado ou desligado.' }, { status: 400 })

  const service = createServiceClient()
  if (!service) return NextResponse.json({ error: 'Servidor sem acesso de gravação configurado.' }, { status: 500 })
  const { data: target } = await service.from('users').select('id, role, org_id, email').eq('id', body.userId).maybeSingle()
  const row = target as { id: string; role: string; org_id: string | null; email: string } | null
  if (!row) return NextResponse.json({ error: 'Usuário não encontrado.' }, { status: 404 })
  if (!canReceiveBrandingAccess({ role: row.role, orgId: row.org_id })) return NextResponse.json({ error: 'Este acesso só pode ser liberado para o administrador de uma empresa.' }, { status: 400 })

  const { error } = await service.from('users').update({ can_manage_branding: body.enabled }).eq('id', row.id)
  if (error) return NextResponse.json({ error: 'Não foi possível salvar. Tente de novo.' }, { status: 500 })
  return NextResponse.json({ ok: true, userId: row.id, enabled: body.enabled })
}
