import { NextResponse } from 'next/server'
import { getAppUser } from '@/lib/app-user'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * POST /api/admin/users/change-email — troca o e-mail de acesso de um
 * usuário cliente (super_admin, ou admin da própria organização alterando
 * um usuário da própria org/unidade). Atualiza tanto public.users quanto a
 * conta no Supabase Auth.
 */
export async function POST(request: Request) {
  const appUser = await getAppUser()
  if (!appUser) {
    return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  }

  const service = createServiceClient()
  if (!service) {
    return NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY não configurada.' }, { status: 500 })
  }

  const body = await request.json().catch(() => null)
  const currentEmail: string | undefined = body?.email?.trim().toLowerCase()
  const newEmail: string | undefined = body?.new_email?.trim().toLowerCase()

  if (!currentEmail || !newEmail) {
    return NextResponse.json({ error: 'email e new_email são obrigatórios.' }, { status: 400 })
  }
  if (currentEmail === newEmail) {
    return NextResponse.json({ error: 'O novo e-mail é igual ao atual.' }, { status: 400 })
  }

  const { data: targetUser } = await service
    .from('users')
    .select('id, org_id, unit_id')
    .eq('email', currentEmail)
    .maybeSingle()
  if (!targetUser) {
    return NextResponse.json({ error: 'Usuário não encontrado.' }, { status: 404 })
  }

  if (!appUser.isSuperAdmin) {
    if (
      appUser.role !== 'admin' ||
      targetUser.org_id !== appUser.orgId ||
      (appUser.unitId && appUser.unitId !== targetUser.unit_id)
    ) {
      return NextResponse.json({ error: 'Sem permissão para alterar o e-mail deste usuário.' }, { status: 403 })
    }
  }

  const { data: existingWithNewEmail } = await service
    .from('users')
    .select('id')
    .eq('email', newEmail)
    .maybeSingle()
  if (existingWithNewEmail) {
    return NextResponse.json({ error: 'Já existe um usuário com esse e-mail.' }, { status: 409 })
  }

  const { data: list, error: listError } = await service.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (listError) {
    return NextResponse.json({ error: `Erro ao buscar usuário: ${listError.message}` }, { status: 500 })
  }
  const authUser = list.users.find((u) => u.email?.toLowerCase() === currentEmail)

  if (authUser) {
    const { error: updateAuthError } = await service.auth.admin.updateUserById(authUser.id, {
      email: newEmail,
      email_confirm: true,
    })
    if (updateAuthError) {
      return NextResponse.json({ error: `Erro ao atualizar conta de login: ${updateAuthError.message}` }, { status: 500 })
    }
  }

  const { error: updateError } = await service.from('users').update({ email: newEmail }).eq('id', targetUser.id)
  if (updateError) {
    return NextResponse.json({ error: `Erro ao atualizar usuário: ${updateError.message}` }, { status: 500 })
  }

  return NextResponse.json({ ok: true, email: newEmail })
}
