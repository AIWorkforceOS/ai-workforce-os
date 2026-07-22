import { NextResponse } from 'next/server'
import { getAppUser } from '@/lib/app-user'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

/**
 * POST /api/organizations/management-mode — persiste a escolha feita na
 * configuração guiada: sistema completo de gestão (full_management) ou só
 * funcionários digitais (digital_employees). Grava em organizations
 * .management_mode (migration 032).
 *
 * Usa service role porque o RLS de organizations só permite escrita de
 * super_admin (migration 005) — mesma situação do vertical_key gravado
 * pela entrevista. A autorização real é feita aqui: usuário autenticado,
 * não-viewer, e a escrita é sempre na PRÓPRIA org (appUser.orgId), nunca
 * numa org vinda do corpo da requisição.
 */
export async function POST(request: Request) {
  const appUser = await getAppUser()
  if (!appUser) {
    return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  }
  if (appUser.role === 'viewer') {
    return NextResponse.json({ error: 'Sem permissão para alterar o modo de uso.' }, { status: 403 })
  }
  if (!appUser.orgId) {
    return NextResponse.json({ error: 'Usuário sem organização vinculada.' }, { status: 400 })
  }

  const body = await request.json().catch(() => null)
  const mode: unknown = body?.mode
  if (mode !== 'full_management' && mode !== 'digital_employees') {
    return NextResponse.json({ error: 'mode deve ser full_management ou digital_employees.' }, { status: 400 })
  }

  const service = createServiceClient()
  if (!service) {
    return NextResponse.json({ error: 'Serviço não configurado.' }, { status: 500 })
  }

  const { error } = await service
    .from('organizations')
    .update({ management_mode: mode })
    .eq('id', appUser.orgId)

  if (error) {
    const migrationMissing = /management_mode/.test(error.message)
    return NextResponse.json(
      {
        error: migrationMissing
          ? 'A plataforma ainda está sendo atualizada (migration 032 pendente). Tente novamente mais tarde.'
          : 'Não foi possível salvar sua escolha. Tente novamente.',
      },
      { status: 500 },
    )
  }

  return NextResponse.json({ ok: true, mode })
}
