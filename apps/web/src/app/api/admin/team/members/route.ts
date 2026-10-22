import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAppUser } from '@/lib/app-user'
import { createServiceClient } from '@/lib/supabase/service'
import { provisionLogin, type UserRowInput } from '@/lib/auth/provision-login'
import { assignableJobRole } from '@/lib/permissions/job-roles'
import { canManageUserAccess } from '@/lib/permissions/user-access'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  name: z.string().trim().min(1, 'Informe o nome.').max(120),
  email: z.string().trim().toLowerCase().email('E-mail inválido.'),
  phone: z.string().trim().max(40).optional(),
  // technician = Portal do Funcionário (só as funções de técnico); os demais = painel do escritório com a função escolhida
  access: z.enum(['technician', 'admin', 'financeiro', 'comercial', 'operacional', 'viewer']),
  login: z.discriminatedUnion('kind', [z.object({ kind: z.literal('password'), password: z.string() }), z.object({ kind: z.literal('invite') })]),
  orgId: z.string().uuid().optional(), // só o super admin escolhe a empresa
  unitId: z.string().uuid().optional(),
  specialty: z.string().trim().max(120).optional(),
  defaultPay: z.number().min(0).max(1_000_000).nullable().optional(),
  defaultPayType: z.enum(['per_service', 'per_hour', 'per_day', 'percent']).optional(),
  isSchedulable: z.boolean().optional(),
})

function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || 'https://www.alizoai.com').replace(/\/+$/, '')
}

/**
 * Cria uma PESSOA nova da equipe em um passo: o cadastro (se for técnico), o login (e-mail + senha definida agora, ou link para a própria pessoa criar a senha)
 * e o que ela acessa — técnico entra só no Portal do Funcionário; as demais funções entram no painel com o acesso da função (Administrador, Financeiro,
 * Comercial, Operacional ou Somente visualização). Só o administrador completo da empresa (ou o super admin). Nada é reaproveitado de contas existentes.
 */
export async function POST(request: Request) {
  const actor = await getAppUser()
  if (!actor) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  if (!canManageUserAccess(actor)) return NextResponse.json({ error: 'Somente o administrador da empresa cria funcionários e acessos.' }, { status: 403 })

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' }, { status: 400 })
  const input = parsed.data

  const orgId = actor.isSuperAdmin ? input.orgId ?? null : actor.orgId
  if (!orgId) return NextResponse.json({ error: 'Informe a empresa.' }, { status: 400 })

  const service = createServiceClient()
  if (!service) return NextResponse.json({ error: 'Servidor sem acesso de gravação configurado.' }, { status: 500 })

  // Unidade: dono de unidade fica na própria; senão a escolhida (da mesma empresa); senão a única da empresa.
  let unitId: string | null = actor.unitId ?? null
  if (!unitId) {
    const { data: units } = await service.from('units').select('id').eq('org_id', orgId).limit(50)
    const ids = ((units ?? []) as { id: string }[]).map((u) => u.id)
    if (input.unitId) {
      if (!ids.includes(input.unitId)) return NextResponse.json({ error: 'Unidade não encontrada nesta empresa.' }, { status: 404 })
      unitId = input.unitId
    } else if (ids.length === 1) unitId = ids[0]!
    else if (input.access === 'technician') return NextResponse.json({ error: 'Escolha a unidade do técnico.' }, { status: 400 })
  } else if (input.unitId && input.unitId !== unitId) {
    return NextResponse.json({ error: 'Você só pode criar pessoas na própria unidade.' }, { status: 403 })
  }

  const mode = input.login.kind === 'password' ? ({ kind: 'password', password: input.login.password } as const) : ({ kind: 'invite', redirectTo: `${siteUrl()}/auth/set-password` } as const)

  // Técnico: cria o cadastro do funcionário primeiro; se o login falhar, o cadastro é desfeito (nada fica pela metade).
  let employeeId: string | null = null
  if (input.access === 'technician') {
    if (!unitId) return NextResponse.json({ error: 'Escolha a unidade do técnico.' }, { status: 400 })
    const { data: employee, error } = await service
      .from('employees')
      .insert({
        org_id: orgId,
        unit_id: unitId,
        name: input.name,
        email: input.email,
        phone: input.phone || null,
        role: 'technician',
        specialty: input.specialty || null,
        default_pay: input.defaultPay ?? null,
        default_pay_type: input.defaultPayType ?? 'per_service',
        is_schedulable: input.isSchedulable ?? true,
      })
      .select('id')
      .single()
    if (error || !employee) return NextResponse.json({ error: 'Não foi possível cadastrar o técnico.' }, { status: 500 })
    employeeId = (employee as { id: string }).id
  }

  const row: UserRowInput =
    input.access === 'technician'
      ? { name: input.name, role: 'employee', org_id: orgId, unit_id: unitId, employee_id: employeeId }
      : input.access === 'viewer'
        ? { name: input.name, role: 'viewer', org_id: orgId, unit_id: actor.unitId ?? null, job_role: null }
        : { name: input.name, role: 'admin', org_id: orgId, unit_id: actor.unitId ?? null, job_role: assignableJobRole(input.access) }

  const created = await provisionLogin(service, { email: input.email, mode, row })
  if (!created.ok) {
    if (employeeId) await service.from('employees').delete().eq('id', employeeId)
    return NextResponse.json({ error: created.error }, { status: created.status })
  }
  return NextResponse.json({ ok: true, email: input.email, access: input.access, employeeId, setupLink: created.setupLink })
}
