import { NextResponse } from 'next/server'
import { getAppUser } from '@/lib/app-user'
import { createServiceClient } from '@/lib/supabase/service'

function generateTempPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(12))
  return Array.from(bytes, (byte) => chars[byte % chars.length]).join('')
}

/**
 * POST /api/admin/users/reset-password — gera uma nova senha temporária
 * para um usuário cliente (apenas super_admin). A senha é retornada UMA
 * única vez para ser repassada por canal seguro.
 */
export async function POST(request: Request) {
  const appUser = await getAppUser()
  if (!appUser?.isSuperAdmin) {
    return NextResponse.json({ error: 'Apenas super admin pode resetar senhas.' }, { status: 403 })
  }

  const service = createServiceClient()
  if (!service) {
    return NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY não configurada.' }, { status: 500 })
  }

  const body = await request.json().catch(() => null)
  const email: string | undefined = body?.email?.trim().toLowerCase()
  if (!email) {
    return NextResponse.json({ error: 'email é obrigatório.' }, { status: 400 })
  }

  const { data: list, error: listError } = await service.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (listError) {
    return NextResponse.json({ error: `Erro ao buscar usuário: ${listError.message}` }, { status: 500 })
  }
  const authUser = list.users.find((u) => u.email?.toLowerCase() === email)
  if (!authUser) {
    return NextResponse.json({ error: 'Usuário não tem conta de login ainda — provisione o acesso primeiro.' }, { status: 404 })
  }

  const tempPassword = generateTempPassword()
  const { error: updateError } = await service.auth.admin.updateUserById(authUser.id, { password: tempPassword })
  if (updateError) {
    return NextResponse.json({ error: `Erro ao resetar senha: ${updateError.message}` }, { status: 500 })
  }

  return NextResponse.json({ ok: true, tempPassword })
}
