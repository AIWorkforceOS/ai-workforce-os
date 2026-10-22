import { NextResponse } from 'next/server'
import { getAppUser } from '@/lib/app-user'
import { createServiceClient } from '@/lib/supabase/service'
import { provisionLogin, resetLoginPassword } from '@/lib/auth/provision-login'

/**
 * Cria (ou reseta) o acesso de login de UM funcionário ao Portal do
 * Funcionário (/portal-funcionario, read-only). Diferente de
 * /api/admin/users: aqui a UNIDADE escolhe a senha e a repassa ao
 * funcionário por fora (WhatsApp, papel etc.) — sem convite/e-mail
 * automático nesta fase.
 *
 *   1. cria a conta no Supabase Auth com a senha informada (ou redefine a senha do login que ESTE funcionário já tem)
 *   2. cria o registro em public.users com
 *      role='employee' + employee_id (isola no RLS — migration 052)
 *   Nunca reaproveita o e-mail de outra pessoa (ver lib/auth/provision-login.ts).
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

  // Este funcionário já tem login? Então só redefine a senha DELE. Nunca assume uma conta que não é dele (antes, um e-mail de outra pessoa/empresa
  // tinha a senha trocada e o papel reescrito).
  const { data: ownLogin } = await service.from('users').select('id, email').eq('employee_id', employee.id).maybeSingle()
  if (ownLogin) {
    const reset = await resetLoginPassword(service, (ownLogin as { email: string }).email, password)
    if (!reset.ok) return NextResponse.json({ error: reset.error }, { status: reset.status })
    await service.from('users').update({ is_active: true }).eq('id', (ownLogin as { id: string }).id)
    return NextResponse.json({ ok: true, email: (ownLogin as { email: string }).email, reset: true })
  }

  const created = await provisionLogin(service, {
    email,
    mode: { kind: 'password', password },
    row: { name: employee.name, role: 'employee', org_id: employee.org_id, unit_id: employee.unit_id, employee_id: employee.id },
  })
  if (!created.ok) return NextResponse.json({ error: created.error }, { status: created.status })
  return NextResponse.json({ ok: true, email })
}
