import { NextResponse } from 'next/server'
import { getAppUser } from '@/lib/app-user'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * Cria (ou reseta) o acesso de login de UM funcionário ao Portal do
 * Funcionário (/portal-funcionario, read-only). Diferente de
 * /api/admin/users: aqui a UNIDADE escolhe a senha e a repassa ao
 * funcionário por fora (WhatsApp, papel etc.) — sem convite/e-mail
 * automático nesta fase.
 *
 *   1. cria/atualiza a conta no Supabase Auth com a senha informada
 *   2. cria/atualiza o registro em public.users com
 *      role='employee' + employee_id (isola no RLS — migration 052)
 *
 * Requer SUPABASE_SERVICE_ROLE_KEY.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: employeeId } = await params

  const appUser = await getAppUser()
  if (!appUser) {
    return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  }
  if (!appUser.isSuperAdmin && appUser.role !== 'admin') {
    return NextResponse.json({ error: 'Sem permissão para criar acesso de funcionário.' }, { status: 403 })
  }

  const service = createServiceClient()
  if (!service) {
    return NextResponse.json(
      { error: 'SUPABASE_SERVICE_ROLE_KEY não configurada — crie o acesso manualmente no painel do Supabase.' },
      { status: 500 },
    )
  }

  const body = await request.json().catch(() => null)
  const email: string | undefined = body?.email?.trim().toLowerCase()
  const password: string | undefined = body?.password

  if (!email || !password) {
    return NextResponse.json({ error: 'E-mail e senha são obrigatórios.' }, { status: 400 })
  }
  if (password.length < 8) {
    return NextResponse.json({ error: 'A senha precisa ter pelo menos 8 caracteres.' }, { status: 400 })
  }

  const { data: employee } = await service
    .from('employees')
    .select('id, org_id, unit_id, name')
    .eq('id', employeeId)
    .maybeSingle()

  if (!employee) {
    return NextResponse.json({ error: 'Funcionário não encontrado.' }, { status: 404 })
  }

  if (!appUser.isSuperAdmin) {
    if (employee.org_id !== appUser.orgId) {
      return NextResponse.json({ error: 'Você só pode criar acesso para funcionários da própria empresa.' }, { status: 403 })
    }
    // Dono de unidade só provisiona acesso para funcionários da própria unidade.
    if (appUser.unitId && appUser.unitId !== employee.unit_id) {
      return NextResponse.json({ error: 'Você só pode criar acesso para funcionários da própria unidade.' }, { status: 403 })
    }
  }

  // Conta de login (Supabase Auth) — senha em texto puro definida pela
  // unidade, não um link de convite (comportamento explicitamente pedido).
  const create = await service.auth.admin.createUser({ email, password, email_confirm: true })
  let authUserId = create.data.user?.id ?? null

  if (create.error) {
    const alreadyExists = /already|registered|exists/i.test(create.error.message)
    if (!alreadyExists) {
      return NextResponse.json({ error: `Erro ao criar conta de login: ${create.error.message}` }, { status: 500 })
    }
    // Conta já existe no Supabase Auth (ex.: reset de senha) — descobre o id
    // via generateLink (mesma técnica usada em /api/admin/users) e atualiza a senha.
    const link = await service.auth.admin.generateLink({ type: 'recovery', email })
    if (link.error || !link.data.user?.id) {
      return NextResponse.json(
        { error: `Já existe uma conta com este e-mail e não foi possível atualizá-la: ${create.error.message}` },
        { status: 500 },
      )
    }
    authUserId = link.data.user.id
    const update = await service.auth.admin.updateUserById(authUserId, { password, email_confirm: true })
    if (update.error) {
      return NextResponse.json({ error: `Erro ao atualizar senha: ${update.error.message}` }, { status: 500 })
    }
  }

  // Registro de negócio (public.users) — upsert por e-mail, sempre role='employee'
  // vinculado ao próprio employee_id (nunca herda outro papel/unidade).
  const { data: existingUser } = await service.from('users').select('id').eq('email', email).maybeSingle()
  const userPayload = {
    email,
    name: employee.name,
    org_id: employee.org_id,
    unit_id: employee.unit_id,
    employee_id: employee.id,
    role: 'employee',
    is_active: true,
  }

  const upsertError = existingUser
    ? (await service.from('users').update(userPayload).eq('id', existingUser.id)).error
    : (await service.from('users').insert(userPayload)).error

  if (upsertError) {
    return NextResponse.json({ error: `Conta de login criada, mas erro ao vincular ao funcionário: ${upsertError.message}` }, { status: 500 })
  }

  return NextResponse.json({ ok: true, email })
}
