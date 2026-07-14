import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

const PLAN_SLUGS = ['starter', 'pro', 'enterprise'] as const
type PlanSlug = (typeof PLAN_SLUGS)[number]

function slugify(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * POST /api/checkout/complete — auto-provisionamento self-service.
 *
 * Cria de verdade a org + unidade principal + registro de acesso
 * (public.users) + conta de login (Supabase Auth) com a senha escolhida
 * pelo cliente no checkout. A cobrança do plano fica registrada como
 * pendente em financial_records (a integração de pagamento entra depois;
 * o acesso é liberado imediatamente — período de garantia de 7 dias).
 */
export async function POST(request: Request) {
  const service = createServiceClient()
  if (!service) {
    return NextResponse.json(
      { error: 'Cadastro automático indisponível no momento. Fale com a gente: suporte@alizo.com.br' },
      { status: 503 },
    )
  }

  const body = await request.json().catch(() => null)
  const company: string | undefined = body?.company?.trim()
  const name: string | undefined = body?.name?.trim()
  const email: string | undefined = body?.email?.trim().toLowerCase()
  const phone: string | null = body?.phone?.trim() || null
  const password: string | undefined = body?.password
  const plan: PlanSlug = PLAN_SLUGS.includes(body?.plan) ? body.plan : 'starter'

  if (!company || !name || !email || !email.includes('@')) {
    return NextResponse.json({ error: 'Preencha empresa, nome e um e-mail válido.' }, { status: 400 })
  }
  if (!password || password.length < 8) {
    return NextResponse.json({ error: 'A senha precisa ter pelo menos 8 caracteres.' }, { status: 400 })
  }

  // E-mail já provisionado → orienta a entrar em vez de duplicar empresa
  const { data: existingUser } = await service.from('users').select('id').ilike('email', email).maybeSingle()
  if (existingUser) {
    return NextResponse.json(
      { error: 'Esse e-mail já tem acesso à plataforma. Entre em alizo — ou fale com suporte@alizo.com.br se esqueceu a senha.' },
      { status: 409 },
    )
  }

  // Slug único para a org
  const baseSlug = slugify(company) || 'empresa'
  let slug = baseSlug
  for (let i = 2; i <= 20; i += 1) {
    const { data: taken } = await service.from('organizations').select('id').eq('slug', slug).maybeSingle()
    if (!taken) break
    slug = `${baseSlug}-${i}`
  }

  const { data: org, error: orgError } = await service
    .from('organizations')
    .insert({ name: company, slug, plan, owner_email: email, is_active: true })
    .select('id')
    .single()
  if (orgError || !org) {
    return NextResponse.json({ error: 'Não foi possível criar sua empresa. Tente novamente.' }, { status: 500 })
  }

  // Cleanup helper: se algo falhar depois da org, não deixa lixo pela metade
  async function rollback() {
    await service!.from('organizations').delete().eq('id', org!.id)
  }

  const { error: unitError } = await service.from('units').insert({
    org_id: org.id,
    name: `${company} — Principal`,
    slug: `${slug}-principal`,
    is_active: true,
  })
  if (unitError) {
    await rollback()
    return NextResponse.json({ error: 'Não foi possível criar sua unidade. Tente novamente.' }, { status: 500 })
  }

  const { error: userError } = await service.from('users').insert({
    email,
    name,
    org_id: org.id,
    role: 'admin',
    is_active: true,
  })
  if (userError) {
    await rollback()
    return NextResponse.json({ error: 'Não foi possível liberar seu acesso. Tente novamente.' }, { status: 500 })
  }

  const { error: authError } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name, phone },
  })
  if (authError) {
    // Conta de auth já existia (ex.: cadastro anterior sem org): mantém a
    // senha atual do usuário e segue — o login existente passa a enxergar a org.
    const alreadyExists = /already|registered|exists/i.test(authError.message)
    if (!alreadyExists) {
      await rollback()
      return NextResponse.json({ error: 'Não foi possível criar sua conta de acesso. Tente novamente.' }, { status: 500 })
    }
  }

  // Registro de cobrança pendente do 1º mês (integração de pagamento: TODO)
  const PLAN_PRICE: Record<PlanSlug, number> = { starter: 297, pro: 597, enterprise: 1497 }
  await service.from('financial_records').insert({
    org_id: org.id,
    type: 'receivable',
    amount: PLAN_PRICE[plan],
    status: 'pending',
    category: 'client_payment',
    description: `Assinatura Alizo — plano ${plan} (1º mês)`,
  })

  return NextResponse.json({ ok: true, orgId: org.id, authAlreadyExisted: !!authError })
}
