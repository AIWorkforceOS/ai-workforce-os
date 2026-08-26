import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { PLAN_PRICING, isLocale, type Locale, type PaidPlanSlug } from '@/lib/i18n/config'
import { sendPaymentGateBlockedEmail, sendPaymentChargeFailedEmail } from '@/lib/email'
import { getPaymentProviderForRegion, type PaymentRegion } from '@/lib/payments/gateway-status'
import { logSystemEvent } from '@/lib/system-events'
import { TERMS_VERSION, PRIVACY_VERSION } from '@/lib/legal'

export const dynamic = 'force-dynamic'

const PLAN_SLUGS = ['starter', 'pro'] as const

const ERRORS: Record<Locale, Record<string, string>> = {
  pt: {
    unavailable: 'Pagamento indisponível no momento. Fale com a gente: suporte@alizo.com.br',
    invalidFields: 'Preencha empresa, nome e um e-mail válido.',
    emailTaken: 'Esse e-mail já tem acesso à plataforma. Entre em alizo — ou fale com suporte@alizo.com.br se esqueceu a senha.',
    termsRequired: 'Você precisa aceitar os Termos de Uso e a Política de Privacidade para continuar.',
    chargeFailed: 'Não foi possível iniciar o pagamento agora. Tente novamente em instantes.',
    enterprise: 'O plano Enterprise é sob consulta — fale com a gente: suporte@alizo.com.br',
  },
  en: {
    unavailable: 'Payment is unavailable right now. Contact us: suporte@alizo.com.br',
    invalidFields: 'Fill in company, name and a valid email.',
    emailTaken: 'This email already has platform access. Sign in — or contact suporte@alizo.com.br if you forgot your password.',
    termsRequired: 'You need to accept the Terms of Service and Privacy Policy to continue.',
    chargeFailed: 'We could not start the payment right now. Please try again shortly.',
    enterprise: 'The Enterprise plan is priced on request — contact us: suporte@alizo.com.br',
  },
}

function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || 'https://www.alizoai.com').replace(/\/+$/, '')
}

async function notifyAdmins(
  service: ReturnType<typeof createServiceClient>,
  build: (to: string) => Promise<{ ok: boolean; error?: string }>,
) {
  const { data: admins } = await service!
    .from('users')
    .select('email')
    .eq('role', 'super_admin')
    .eq('is_active', true)
  const adminEmails = (admins ?? []).map((a) => a.email).filter((e): e is string => !!e)
  await Promise.all(adminEmails.map(build))
}

/**
 * POST /api/checkout/start-payment — 1ª etapa do checkout self-service.
 *
 * Mudança de arquitetura (2026-08-26, pedido explícito do Vinicius): a
 * conta NÃO é mais criada aqui. Este endpoint só valida os dados,
 * registra um rascunho em pending_signups e devolve o link do checkout
 * hospedado da processadora (Asaas/Stripe) — o cliente digita o cartão
 * só lá, nunca no nosso servidor. A conta de verdade (org + unit + user)
 * só nasce quando o webhook de pagamento confirma a aprovação (ver
 * lib/payments/webhook-handler.ts) — reprovado ou abandonado, nenhuma
 * conta chega a existir.
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

  if (body?.plan === 'enterprise') {
    return NextResponse.json({ error: err.enterprise }, { status: 400 })
  }
  const plan: PaidPlanSlug = PLAN_SLUGS.includes(body?.plan) ? body.plan : 'starter'
  const currency: 'BRL' | 'USD' = locale === 'en' ? 'USD' : 'BRL'

  if (!company || !name || !email || !email.includes('@')) {
    return NextResponse.json({ error: err.invalidFields }, { status: 400 })
  }
  if (body?.termsAccepted !== true) {
    return NextResponse.json({ error: err.termsRequired }, { status: 400 })
  }

  const { data: existingUser } = await service.from('users').select('id').ilike('email', email).maybeSingle()
  if (existingUser) {
    return NextResponse.json({ error: err.emailTaken }, { status: 409 })
  }

  const region: PaymentRegion = locale === 'en' ? 'US' : 'BR'
  const amount = currency === 'USD' ? PLAN_PRICING[plan].usd : PLAN_PRICING[plan].brl

  const paymentProvider = await getPaymentProviderForRegion(service, region)
  if (!paymentProvider) {
    await Promise.all([
      logSystemEvent(service, {
        level: 'warning',
        source: 'checkout',
        eventType: 'payment_provider_missing',
        message: `Tentativa de cadastro bloqueada — sem processadora ativa para a região ${region}.`,
        metadata: { name, email, phone, plan, region },
      }),
      notifyAdmins(service, (to) => sendPaymentGateBlockedEmail({ to, region, plan, name, email, phone })),
    ])
    return NextResponse.json({ error: err.unavailable }, { status: 503 })
  }

  const forwardedFor = request.headers.get('x-forwarded-for')
  const clientIp = forwardedFor ? forwardedFor.split(',')[0]!.trim() : null

  const { data: pending, error: pendingError } = await service
    .from('pending_signups')
    .insert({
      company,
      name,
      email,
      phone,
      plan,
      currency,
      region,
      locale,
      amount,
      payment_method: 'card',
      provider: paymentProvider.id,
      status: 'pending',
      terms_version: TERMS_VERSION,
      privacy_version: PRIVACY_VERSION,
      accept_ip: clientIp,
    })
    .select('id')
    .single()
  if (pendingError || !pending) {
    return NextResponse.json({ error: err.chargeFailed }, { status: 500 })
  }

  const chargeResult = await paymentProvider.createCustomerAndCharge({
    name,
    email,
    phone,
    plan,
    amount,
    currency,
    paymentMethod: 'card',
    description: `Assinatura Alizo — plano ${plan} (1º mês)`,
    successUrl: `${siteUrl()}/checkout/finish?pending=${pending.id}`,
    cancelUrl: `${siteUrl()}/checkout?canceled=1&plan=${plan}`,
  })

  if (!chargeResult.ok) {
    await service.from('pending_signups').delete().eq('id', pending.id)
    await Promise.all([
      logSystemEvent(service, {
        level: 'error',
        source: 'checkout',
        eventType: 'payment_charge_failed',
        message: `Cadastro bloqueado — a cobrança automática (${paymentProvider.id}) falhou: ${chargeResult.error}`,
        metadata: { name, email, phone, plan, region, provider: paymentProvider.id },
      }),
      notifyAdmins(service, (to) =>
        sendPaymentChargeFailedEmail({ to, provider: paymentProvider.id, region, plan, name, email, phone, error: chargeResult.error }),
      ),
    ])
    return NextResponse.json({ error: err.chargeFailed }, { status: 502 })
  }

  await service
    .from('pending_signups')
    .update({ provider_customer_ref: chargeResult.providerCustomerRef, provider_charge_ref: chargeResult.providerChargeRef })
    .eq('id', pending.id)

  return NextResponse.json({ ok: true, paymentUrl: chargeResult.paymentUrl })
}
