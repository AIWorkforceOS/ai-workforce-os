import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { PLAN_PRICING, isLocale, type Locale, type PaidPlanSlug } from '@/lib/i18n/config'
import { sendWelcomeEmail } from '@/lib/email'

export const dynamic = 'force-dynamic'

const PLAN_SLUGS = ['starter', 'pro'] as const

// Sem parcelamento no lançamento: PIX/boleto só no Brasil, Zelle só nos EUA,
// cartão (débito/crédito à vista) nos dois mercados.
const PAYMENT_METHODS = ['pix', 'card', 'boleto', 'zelle'] as const
type PaymentMethod = (typeof PAYMENT_METHODS)[number]

const ERRORS: Record<Locale, Record<string, string>> = {
  pt: {
    unavailable: 'Cadastro automático indisponível no momento. Fale com a gente: suporte@alizo.com.br',
    invalidFields: 'Preencha empresa, nome e um e-mail válido.',
    shortPassword: 'A senha precisa ter pelo menos 8 caracteres.',
    emailTaken: 'Esse e-mail já tem acesso à plataforma. Entre em alizo — ou fale com suporte@alizo.com.br se esqueceu a senha.',
    orgFailed: 'Não foi possível criar sua empresa. Tente novamente.',
    unitFailed: 'Não foi possível criar sua unidade. Tente novamente.',
    accessFailed: 'Não foi possível liberar seu acesso. Tente novamente.',
    authFailed: 'Não foi possível criar sua conta de acesso. Tente novamente.',
    enterprise: 'O plano Enterprise é sob consulta — fale com a gente: suporte@alizo.com.br',
  },
  en: {
    unavailable: 'Automatic signup is unavailable right now. Contact us: suporte@alizo.com.br',
    invalidFields: 'Fill in company, name and a valid email.',
    shortPassword: 'The password must be at least 8 characters long.',
    emailTaken: 'This email already has platform access. Sign in — or contact suporte@alizo.com.br if you forgot your password.',
    orgFailed: 'We could not create your company. Please try again.',
    unitFailed: 'We could not create your unit. Please try again.',
    accessFailed: 'We could not grant your access. Please try again.',
    authFailed: 'We could not create your login account. Please try again.',
    enterprise: 'The Enterprise plan is priced on request — contact us: suporte@alizo.com.br',
  },
}

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
 * pendente em financial_records — em R$ (Brasil) ou US$ (EUA), conforme
 * a localidade detectada — e a integração com a processadora escolhida
 * entra depois; o acesso é liberado imediatamente (garantia de 7 dias).
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const locale: Locale = isLocale(body?.locale) ? body.locale : 'pt'
  const err = ERRORS[locale]

  const service = createServiceClient()
  if (!service) {
    return NextResponse.json({ error: err.unavailable }, { status: 503 })
  }

  const company: string | undefined = body?.company?.trim()
  const name: string | undefined = body?.name?.trim()
  const email: string | undefined = body?.email?.trim().toLowerCase()
  const phone: string | null = body?.phone?.trim() || null
  const password: string | undefined = body?.password

  if (body?.plan === 'enterprise') {
    return NextResponse.json({ error: err.enterprise }, { status: 400 })
  }
  const plan: PaidPlanSlug = PLAN_SLUGS.includes(body?.plan) ? body.plan : 'starter'
  const currency: 'BRL' | 'USD' = locale === 'en' ? 'USD' : 'BRL'
  const paymentMethod: PaymentMethod = PAYMENT_METHODS.includes(body?.paymentMethod)
    ? body.paymentMethod
    : locale === 'en' ? 'zelle' : 'pix'

  if (!company || !name || !email || !email.includes('@')) {
    return NextResponse.json({ error: err.invalidFields }, { status: 400 })
  }
  if (!password || password.length < 8) {
    return NextResponse.json({ error: err.shortPassword }, { status: 400 })
  }

  // E-mail já provisionado → orienta a entrar em vez de duplicar empresa
  const { data: existingUser } = await service.from('users').select('id').ilike('email', email).maybeSingle()
  if (existingUser) {
    return NextResponse.json({ error: err.emailTaken }, { status: 409 })
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
    return NextResponse.json({ error: err.orgFailed }, { status: 500 })
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
    return NextResponse.json({ error: err.unitFailed }, { status: 500 })
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
    return NextResponse.json({ error: err.accessFailed }, { status: 500 })
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
      return NextResponse.json({ error: err.authFailed }, { status: 500 })
    }
  }

  // Registro de cobrança pendente do 1º mês (integração de pagamento: TODO —
  // depende da processadora escolhida no painel Super Admin → Pagamentos)
  const amount = currency === 'USD' ? PLAN_PRICING[plan].usd : PLAN_PRICING[plan].brl
  const billingRow = {
    org_id: org.id,
    type: 'receivable',
    amount,
    status: 'pending',
    category: 'client_payment',
    description: `Assinatura Alizo — plano ${plan} (1º mês) · ${paymentMethod} · ${currency}`,
  }
  // currency/payment_method existem a partir da migration 20260714000009;
  // se ela ainda não tiver sido aplicada, registra sem as colunas novas.
  const { error: billingError } = await service
    .from('financial_records')
    .insert({ ...billingRow, currency, payment_method: paymentMethod })
  if (billingError) {
    await service.from('financial_records').insert(billingRow)
  }

  // E-mail de boas-vindas — sem link de senha aqui: a pessoa já escolheu a
  // própria senha no checkout, então só confirmamos o cadastro. Falha no
  // envio não deve travar o checkout (acesso já foi liberado acima).
  await sendWelcomeEmail({ to: email, name, companyName: company, setPasswordUrl: null })

  return NextResponse.json({ ok: true, orgId: org.id, authAlreadyExisted: !!authError })
}
