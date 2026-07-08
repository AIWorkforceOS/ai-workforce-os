import { NextResponse } from 'next/server'
import { getAppUser } from '@/lib/app-user'
import { createServiceClient } from '@/lib/supabase/service'

function generateTempPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(12))
  return Array.from(bytes, (byte) => chars[byte % chars.length]).join('')
}

/**
 * Provisiona o acesso de um cliente à plataforma (apenas super_admin):
 *   1. cria o usuário no Supabase Auth com senha temporária
 *   2. cria o registro em public.users vinculado à org (role 'admin')
 *
 * A senha temporária é retornada UMA única vez para ser repassada ao
 * cliente por canal seguro. Requer SUPABASE_SERVICE_ROLE_KEY.
 */
export async function POST(request: Request) {
  const appUser = await getAppUser()
  if (!appUser?.isSuperAdmin) {
    return NextResponse.json({ error: 'Apenas super admin pode provisionar usuários.' }, { status: 403 })
  }

  const service = createServiceClient()
  if (!service) {
    return NextResponse.json(
      { error: 'SUPABASE_SERVICE_ROLE_KEY não configurada — crie o usuário manualmente no painel do Supabase.' },
      { status: 500 },
    )
  }

  const body = await request.json().catch(() => null)
  const email: string | undefined = body?.email?.trim().toLowerCase()
  const name: string | null = body?.name?.trim() || null
  const orgId: string | undefined = body?.org_id
  const role: string = body?.role === 'viewer' ? 'viewer' : 'admin'

  if (!email || !orgId) {
    return NextResponse.json({ error: 'email e org_id são obrigatórios.' }, { status: 400 })
  }

  const { data: org } = await service.from('organizations').select('id, name').eq('id', orgId).maybeSingle()
  if (!org) {
    return NextResponse.json({ error: 'Organização não encontrada.' }, { status: 404 })
  }

  // Registro de negócio (public.users) — upsert por e-mail
  const { data: existingUser } = await service.from('users').select('id').eq('email', email).maybeSingle()
  if (existingUser) {
    const { error: updateError } = await service
      .from('users')
      .update({ org_id: orgId, role, name: name ?? undefined, is_active: true })
      .eq('id', existingUser.id)
    if (updateError) {
      return NextResponse.json({ error: `Erro ao atualizar usuário: ${updateError.message}` }, { status: 500 })
    }
  } else {
    const { error: insertError } = await service
      .from('users')
      .insert({ email, name, org_id: orgId, role })
    if (insertError) {
      return NextResponse.json({ error: `Erro ao criar usuário: ${insertError.message}` }, { status: 500 })
    }
  }

  // Conta de login (Supabase Auth) com senha temporária
  const tempPassword = generateTempPassword()
  const { error: authError } = await service.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
  })

  if (authError) {
    // Conta de auth já existe: acesso segue funcionando com a senha atual
    const alreadyExists = /already|registered|exists/i.test(authError.message)
    if (alreadyExists) {
      return NextResponse.json({
        ok: true,
        email,
        tempPassword: null,
        note: 'Usuário vinculado à empresa. A conta de login já existia — a senha atual continua valendo.',
      })
    }
    return NextResponse.json(
      { error: `Usuário vinculado, mas falha ao criar login: ${authError.message}` },
      { status: 500 },
    )
  }

  return NextResponse.json({ ok: true, email, tempPassword })
}
