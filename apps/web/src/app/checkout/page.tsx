'use client'

import { useState, useEffect, useRef, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Check, CreditCard, Zap, Lock, ArrowRight, Loader2, Mail, RefreshCw } from 'lucide-react'
import { useLocale } from '@/lib/i18n/client'
import { currencyForLocale, planPrice, type Locale, type PaidPlanSlug } from '@/lib/i18n/config'

const brandGradient = 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)'
const CONTACT_EMAIL = 'suporte@alizo.com.br'

const COPY = {
  pt: {
    plans: {
      starter: {
        name: 'Starter',
        features: ['1 unidade', '1 funcionário digital', 'WhatsApp 24/7 + prospecção', 'Suporte por e-mail'],
      },
      pro: {
        name: 'Pro',
        features: ['Até 5 unidades', 'Até 3 funcionários digitais', 'Funil de vendas completo', 'Suporte prioritário', 'Configuração assistida'],
      },
    },
    steps: ['Sua conta', 'Pagamento'],
    checkoutSecure: 'Checkout seguro',
    loading: 'Carregando...',
    account: {
      title: 'Crie sua conta',
      sub: 'Com esses dados preparamos sua empresa na plataforma — o acesso é liberado assim que o pagamento for aprovado.',
      company: 'Nome da empresa *', companyPh: 'Ex: Padaria Estrela',
      name: 'Seu nome *', namePh: 'Ex: Maria Silva',
      email: 'E-mail *', emailPh: 'voce@empresa.com',
      phone: 'WhatsApp / Telefone', phonePh: '+55 11 99999-0000',
      continue: 'Continuar para pagamento',
      agreePrefix: 'Li e concordo com os ',
      agreeTerms: 'Termos de Uso',
      agreeMiddle: ' e a ',
      agreePrivacy: 'Política de Privacidade',
      agreeSuffix: '.',
    },
    payment: {
      title: 'Forma de pagamento',
      boxTitle: 'Pagamento seguro na processadora',
      boxText: 'Você será levado para a página segura de pagamento pra digitar os dados do cartão (crédito ou débito) — nunca ficam com a gente. Aprovado o pagamento, seu acesso é liberado na hora.',
      back: 'Voltar',
      submit: 'Ir para pagamento seguro',
      submitting: 'Preparando pagamento...',
      trust: '✓ 7 dias de garantia total  ·  ✓ Cancele quando quiser  ·  ✓ Dados protegidos por SSL',
    },
    finish: {
      waitingTitle: 'Confirmando seu pagamento...',
      waitingSub: 'Isso pode levar alguns instantes. Não feche esta página.',
      successTitle: 'Pagamento aprovado! 🎉',
      successSub1: 'Sua empresa ', successSub2: ' já está na Alizo.',
      successSub3: 'Enviamos um e-mail pra você definir sua senha e entrar.',
      cta: 'Ir para o login',
      stillPendingTitle: 'Ainda confirmando com a operadora',
      stillPendingSub: 'Pode levar mais alguns instantes. Você também recebe a confirmação por e-mail assim que aprovar.',
      retry: 'Atualizar',
      notFoundTitle: 'Não encontramos esse pagamento',
      notFoundSub: `Se você concluiu o pagamento e isso persistir, fale com a gente: ${CONTACT_EMAIL}`,
      backToCheckout: 'Voltar para o checkout',
    },
    canceled: {
      title: 'Pagamento cancelado',
      sub: 'Você pode tentar novamente quando quiser.',
    },
    summary: {
      eyebrow: 'Resumo do pedido', plan: 'Plano', total: 'Total mensal', taxes: '+ impostos aplicáveis',
      badges: ['Pagamento seguro SSL', '7 dias de garantia', 'Cancele quando quiser'],
    },
    enterprise: {
      title: 'Plano Enterprise — sob consulta',
      text: 'O Enterprise é desenhado sob medida para grandes redes: escopo, número de unidades e preço são definidos com você. Fale com a gente e montamos a proposta.',
      cta: 'Falar com a equipe',
      backHome: 'Voltar para o site',
    },
    errors: {
      generic: 'Não foi possível concluir seu cadastro. Tente novamente.',
      connection: 'Falha de conexão. Verifique sua internet e tente novamente.',
    },
  },
  en: {
    plans: {
      starter: {
        name: 'Starter',
        features: ['1 unit', '1 digital employee', '24/7 WhatsApp + prospecting', 'Email support'],
      },
      pro: {
        name: 'Pro',
        features: ['Up to 5 units', 'Up to 3 digital employees', 'Full sales pipeline', 'Priority support', 'Assisted setup'],
      },
    },
    steps: ['Your account', 'Payment'],
    checkoutSecure: 'Secure checkout',
    loading: 'Loading...',
    account: {
      title: 'Create your account',
      sub: 'We use this to set up your company on the platform — access is granted right after payment is approved.',
      company: 'Company name *', companyPh: 'E.g.: Star Bakery',
      name: 'Your name *', namePh: 'E.g.: Mary Smith',
      email: 'Email *', emailPh: 'you@company.com',
      phone: 'WhatsApp / Phone', phonePh: '+1 (555) 000-0000',
      continue: 'Continue to payment',
      agreePrefix: 'I have read and agree to the ',
      agreeTerms: 'Terms of Service',
      agreeMiddle: ' and the ',
      agreePrivacy: 'Privacy Policy',
      agreeSuffix: '.',
    },
    payment: {
      title: 'Payment method',
      boxTitle: 'Secure payment on the processor',
      boxText: "You'll be taken to the payment processor's secure page to enter your card details (credit or debit) — we never see or store them. Once approved, your access is granted instantly.",
      back: 'Back',
      submit: 'Go to secure payment',
      submitting: 'Preparing payment...',
      trust: '✓ Full 7-day guarantee  ·  ✓ Cancel anytime  ·  ✓ SSL-protected data',
    },
    finish: {
      waitingTitle: 'Confirming your payment...',
      waitingSub: 'This can take a few moments. Please don’t close this page.',
      successTitle: 'Payment approved! 🎉',
      successSub1: 'Your company ', successSub2: ' is now on Alizo.',
      successSub3: 'We emailed you a link to set your password and sign in.',
      cta: 'Go to login',
      stillPendingTitle: 'Still confirming with the processor',
      stillPendingSub: 'This can take a bit longer. You will also get an email confirmation once it’s approved.',
      retry: 'Refresh',
      notFoundTitle: 'We could not find that payment',
      notFoundSub: `If you completed payment and this persists, contact us: ${CONTACT_EMAIL}`,
      backToCheckout: 'Back to checkout',
    },
    canceled: {
      title: 'Payment canceled',
      sub: 'You can try again whenever you like.',
    },
    summary: {
      eyebrow: 'Order summary', plan: 'Plan', total: 'Monthly total', taxes: '+ applicable taxes',
      badges: ['SSL secure payment', '7-day guarantee', 'Cancel anytime'],
    },
    enterprise: {
      title: 'Enterprise plan — custom pricing',
      text: 'Enterprise is tailored to large networks: scope, number of units and pricing are defined with you. Talk to us and we will put a proposal together.',
      cta: 'Talk to the team',
      backHome: 'Back to the site',
    },
    errors: {
      generic: 'We could not complete your signup. Please try again.',
      connection: 'Connection failed. Check your internet and try again.',
    },
  },
} as const

type Copy = (typeof COPY)[Locale]

/** aceita os slugs antigos do site (basico) e novos (starter) */
function resolvePlan(param: string | null): PaidPlanSlug | 'enterprise' {
  if (param === 'pro') return 'pro'
  if (param === 'enterprise') return 'enterprise'
  return 'starter'
}

function formatPrice(amount: number, locale: Locale): string {
  return locale === 'en'
    ? `US$ ${amount.toLocaleString('en-US')}`
    : `R$ ${amount.toLocaleString('pt-BR')}`
}

function EnterpriseContact({ t }: { t: Copy }) {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-6 py-20 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full"
        style={{ background: brandGradient, boxShadow: '0 0 40px rgba(6,182,212,0.4)' }}>
        <Mail size={26} className="text-white" />
      </div>
      <h2 className="text-3xl font-black text-white">{t.enterprise.title}</h2>
      <p className="text-slate-400">{t.enterprise.text}</p>
      <a
        href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(t.enterprise.title)}`}
        className="flex items-center gap-2 rounded-2xl px-8 py-4 text-sm font-black text-white"
        style={{ background: brandGradient, boxShadow: '0 6px 20px rgba(6,182,212,0.3)' }}
      >
        {t.enterprise.cta}
        <ArrowRight size={14} />
      </a>
      <Link href="/" className="text-sm text-slate-500 transition-colors hover:text-white">
        {t.enterprise.backHome}
      </Link>
    </div>
  )
}

type FinishStatus = 'pending' | 'completed' | 'expired' | 'not_found'

/** Tela de retorno do checkout hospedado (Asaas/Stripe) — faz polling até o webhook confirmar o pagamento e provisionar a conta (ver lib/payments/webhook-handler.ts). */
function FinishScreen({ pendingId, t }: { pendingId: string; t: Copy }) {
  const [status, setStatus] = useState<FinishStatus>('pending')
  const [elapsedMs, setElapsedMs] = useState(0)
  const startedAt = useRef(Date.now())

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>

    async function poll() {
      try {
        const res = await fetch(`/api/checkout/status?pending=${encodeURIComponent(pendingId)}`, { cache: 'no-store' })
        const data = await res.json()
        if (cancelled) return
        const nextStatus: FinishStatus = data.status ?? 'not_found'
        setStatus(nextStatus)
        setElapsedMs(Date.now() - startedAt.current)
        if (nextStatus === 'pending') {
          timer = setTimeout(poll, 2500)
        }
      } catch {
        if (!cancelled) timer = setTimeout(poll, 2500)
      }
    }
    poll()

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [pendingId])

  if (status === 'completed') {
    return (
      <div className="flex flex-col items-center gap-6 py-20 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full"
          style={{ background: brandGradient, boxShadow: '0 0 40px rgba(6,182,212,0.4)' }}>
          <Check size={36} className="text-white" />
        </div>
        <div>
          <h2 className="text-3xl font-black text-white">{t.finish.successTitle}</h2>
          <p className="mt-3 text-slate-400">{t.finish.successSub1}{t.finish.successSub2}</p>
          <p className="mt-1 text-sm text-slate-500">{t.finish.successSub3}</p>
        </div>
        <Link
          href="/login"
          className="flex items-center gap-2 rounded-2xl px-8 py-4 text-sm font-black text-white"
          style={{ background: brandGradient, boxShadow: '0 6px 20px rgba(6,182,212,0.3)' }}
        >
          {t.finish.cta}
          <ArrowRight size={14} />
        </Link>
      </div>
    )
  }

  if (status === 'not_found' || status === 'expired') {
    return (
      <div className="flex flex-col items-center gap-6 py-20 text-center">
        <h2 className="text-2xl font-black text-white">{t.finish.notFoundTitle}</h2>
        <p className="max-w-sm text-sm text-slate-400">{t.finish.notFoundSub}</p>
        <Link href="/checkout" className="text-sm font-bold text-cyan-400 hover:text-cyan-300">
          {t.finish.backToCheckout}
        </Link>
      </div>
    )
  }

  const stillWaitingAfterAWhile = elapsedMs > 20000
  return (
    <div className="flex flex-col items-center gap-6 py-20 text-center">
      <Loader2 size={40} className="animate-spin text-cyan-400" />
      <div>
        <h2 className="text-2xl font-black text-white">
          {stillWaitingAfterAWhile ? t.finish.stillPendingTitle : t.finish.waitingTitle}
        </h2>
        <p className="mt-2 max-w-sm text-sm text-slate-400">
          {stillWaitingAfterAWhile ? t.finish.stillPendingSub : t.finish.waitingSub}
        </p>
      </div>
      {stillWaitingAfterAWhile && (
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="flex items-center gap-2 rounded-xl border border-white/10 px-4 py-2 text-xs font-bold text-slate-300 hover:bg-white/5"
        >
          <RefreshCw size={12} />
          {t.finish.retry}
        </button>
      )}
    </div>
  )
}

function CheckoutForm() {
  const params = useSearchParams()
  const locale = useLocale()
  const t: Copy = COPY[locale]

  const planSlug = resolvePlan(params.get('plan'))
  const pendingId = params.get('pending')
  const canceled = params.get('canceled') === '1'

  const [step, setStep] = useState<1 | 2>(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [termsAccepted, setTermsAccepted] = useState(false)

  const [form, setForm] = useState({
    company: '',
    name: '',
    email: '',
    phone: '',
  })

  if (pendingId) {
    return <FinishScreen pendingId={pendingId} t={t} />
  }

  if (planSlug === 'enterprise') {
    return <EnterpriseContact t={t} />
  }

  const plan = t.plans[planSlug]
  const price = planPrice(planSlug, locale)

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setForm(f => ({ ...f, [e.target.name]: e.target.value }))
  }

  function step1Valid() {
    return form.company.trim() && form.name.trim() && form.email.includes('@') && termsAccepted
  }

  async function handleGoToPayment() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/checkout/start-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          plan: planSlug,
          locale,
          currency: currencyForLocale(locale),
          termsAccepted,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.paymentUrl) {
        setError(data.error ?? t.errors.generic)
        setLoading(false)
        return
      }
      window.location.href = data.paymentUrl
    } catch {
      setError(t.errors.connection)
      setLoading(false)
    }
  }

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-5">
      {/* Esquerda — formulário */}
      <div className="lg:col-span-3">
        {/* Etapas */}
        <div className="mb-8 flex items-center gap-3">
          {[1, 2].map(s => (
            <div key={s} className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-black transition-all"
                style={step >= s
                  ? { background: brandGradient, color: '#fff' }
                  : { background: 'rgba(255,255,255,0.06)', color: '#64748b' }}>
                {step > s ? <Check size={12} /> : s}
              </div>
              <span className="text-xs font-semibold" style={{ color: step >= s ? '#cbd5e1' : '#64748b' }}>
                {t.steps[s - 1]}
              </span>
              {s < 2 && <div className="h-px w-8 bg-white/10" />}
            </div>
          ))}
        </div>

        {canceled && (
          <div className="mb-6 rounded-xl px-4 py-3" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
            <p className="text-sm font-bold text-red-300">{t.canceled.title}</p>
            <p className="text-xs text-red-400/80">{t.canceled.sub}</p>
          </div>
        )}

        {/* Passo 1 — dados + termos */}
        {step === 1 && (
          <div className="space-y-4">
            <h2 className="text-xl font-black text-white">{t.account.title}</h2>
            <p className="text-sm text-slate-500">{t.account.sub}</p>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label={t.account.company} name="company" value={form.company} onChange={handleChange} placeholder={t.account.companyPh} />
              <Field label={t.account.name} name="name" value={form.name} onChange={handleChange} placeholder={t.account.namePh} />
              <Field label={t.account.email} name="email" type="email" value={form.email} onChange={handleChange} placeholder={t.account.emailPh} />
              <Field label={t.account.phone} name="phone" value={form.phone} onChange={handleChange} placeholder={t.account.phonePh} />
            </div>

            <label className="flex items-start gap-2.5 text-xs text-slate-400">
              <input
                type="checkbox"
                checked={termsAccepted}
                onChange={(e) => setTermsAccepted(e.target.checked)}
                className="mt-0.5 h-4 w-4 flex-shrink-0 accent-cyan-500"
              />
              <span>
                {t.account.agreePrefix}
                <Link href="/terms" target="_blank" className="text-cyan-400 underline hover:text-cyan-300">
                  {t.account.agreeTerms}
                </Link>
                {t.account.agreeMiddle}
                <Link href="/privacy" target="_blank" className="text-cyan-400 underline hover:text-cyan-300">
                  {t.account.agreePrivacy}
                </Link>
                {t.account.agreeSuffix}
              </span>
            </label>

            <button
              type="button"
              onClick={() => step1Valid() && setStep(2)}
              disabled={!step1Valid()}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-sm font-black text-white transition-all"
              style={step1Valid()
                ? { background: brandGradient, boxShadow: '0 6px 20px rgba(6,182,212,0.3)' }
                : { background: 'rgba(255,255,255,0.06)', color: '#64748b', cursor: 'not-allowed' }}
            >
              {t.account.continue}
              <ArrowRight size={14} />
            </button>
          </div>
        )}

        {/* Passo 2 — pagamento */}
        {step === 2 && (
          <div className="space-y-5">
            <h2 className="text-xl font-black text-white">{t.payment.title}</h2>

            <div className="space-y-3 rounded-2xl border border-white/10 p-5" style={{ background: 'rgba(255,255,255,0.03)' }}>
              <Row label={t.account.company} value={form.company} />
              <Row label={t.account.name} value={form.name} />
              <Row label={t.account.email} value={form.email} />
              <Row label={t.summary.plan} value={`Alizo ${plan.name}`} />
              <div className="border-t border-white/10 pt-3">
                <Row label={t.summary.total} value={`${formatPrice(price, locale)}/${locale === 'en' ? 'mo' : 'mês'}`} highlight />
              </div>
            </div>

            <div className="rounded-2xl p-5" style={{ background: 'rgba(6,182,212,0.06)', border: '1px solid rgba(6,182,212,0.2)' }}>
              <p className="flex items-center gap-2 text-sm font-bold text-cyan-300">
                <CreditCard size={14} /> {t.payment.boxTitle}
              </p>
              <p className="mt-1 text-xs text-slate-400">{t.payment.boxText}</p>
            </div>

            <p className="text-xs text-slate-600">{t.payment.trust}</p>

            {error && (
              <div className="rounded-xl px-4 py-3" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
                <p className="text-sm text-red-400">{error}</p>
              </div>
            )}

            <div className="flex gap-3">
              <button type="button" onClick={() => setStep(1)}
                className="flex-1 rounded-2xl border border-white/10 py-3.5 text-sm font-bold text-slate-400 hover:bg-white/5">
                {t.payment.back}
              </button>
              <button
                type="button"
                onClick={handleGoToPayment}
                disabled={loading}
                className="flex flex-[2] items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50"
                style={{ background: brandGradient, boxShadow: '0 6px 20px rgba(6,182,212,0.3)' }}
              >
                {loading ? <Loader2 size={16} className="animate-spin" /> : <Lock size={14} />}
                {loading ? t.payment.submitting : t.payment.submit}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Direita — resumo */}
      <div className="lg:col-span-2">
        <div className="sticky top-24 rounded-3xl border border-white/10 p-6" style={{ background: 'rgba(255,255,255,0.03)' }}>
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{t.summary.eyebrow}</p>
          <div className="mt-4 flex items-center gap-3">
            <img src="/branding/alizo-icon.png" alt="Alizo" className="h-10 w-auto" />
            <div>
              <p className="text-sm font-black text-white">alizo</p>
              <p className="text-xs text-slate-500">{t.summary.plan} {plan.name}</p>
            </div>
          </div>

          <div className="mt-5 space-y-2.5">
            {plan.features.map(f => (
              <div key={f} className="flex items-center gap-2.5 text-sm text-slate-400">
                <Check size={13} className="flex-shrink-0 text-cyan-400" />
                {f}
              </div>
            ))}
          </div>

          <div className="mt-5 border-t border-white/10 pt-5">
            <div className="flex items-end justify-between">
              <span className="text-sm text-slate-500">{t.summary.total}</span>
              <span className="text-2xl font-black text-white">{formatPrice(price, locale)}</span>
            </div>
            <p className="mt-1 text-right text-xs text-slate-600">{t.summary.taxes}</p>
          </div>

          <div className="mt-5 space-y-2">
            {t.summary.badges.map((text, i) => {
              const Icon = [Lock, Zap, Check][i]!
              return (
                <div key={text} className="flex items-center gap-2 text-xs text-slate-500">
                  <Icon size={12} className="text-cyan-400" />
                  {text}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({ label, name, value, onChange, type = 'text', placeholder }: {
  label: string; name: string; value: string
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  type?: string; placeholder?: string
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-bold text-slate-400">{label}</label>
      <input
        type={type}
        name={name}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder-slate-600 outline-none transition-colors focus:border-cyan-500/50"
      />
    </div>
  )
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-slate-500">{label}</span>
      <span className={`text-sm font-bold ${highlight ? 'text-cyan-400' : 'text-white'}`}>{value}</span>
    </div>
  )
}

export default function CheckoutPage() {
  const locale = useLocale()
  const t = COPY[locale]
  return (
    <div className="min-h-screen" style={{ background: '#0a0f1e', color: '#fff' }}>
      {/* Nav */}
      <nav className="border-b border-white/[0.06] px-6 py-4" style={{ background: 'rgba(10,15,30,0.9)' }}>
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <img src="/branding/alizo-logo.png" alt="Alizo" className="h-7 w-auto" />
          </Link>
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <Lock size={11} />
            {t.checkoutSecure}
          </div>
        </div>
      </nav>

      <div className="mx-auto max-w-5xl px-6 py-10">
        <Suspense fallback={<div className="text-sm text-slate-500">{t.loading}</div>}>
          <CheckoutForm />
        </Suspense>
      </div>
    </div>
  )
}
