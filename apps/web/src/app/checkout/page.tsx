'use client'

import { useState, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Check, CreditCard, Zap, Lock, ArrowRight, Loader2, Mail } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useLocale } from '@/lib/i18n/client'
import { currencyForLocale, planPrice, type Locale, type PaidPlanSlug } from '@/lib/i18n/config'

const brandGradient = 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)'
const CONTACT_EMAIL = 'suporte@alizo.com.br'

/**
 * Formas de pagamento do lançamento — sem parcelamento:
 * Brasil: PIX, cartão (débito/crédito à vista) e boleto.
 * EUA: cartão (débito/crédito, cobrança única mensal).
 */
type PaymentMethod = 'pix' | 'card' | 'boleto' | 'zelle'

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
    paymentMethods: [
      { id: 'pix' as PaymentMethod, label: 'PIX', flag: '⚡', sub: 'Aprovação imediata' },
      { id: 'card' as PaymentMethod, label: 'Cartão', flag: '💳', sub: 'Débito ou crédito à vista' },
      { id: 'boleto' as PaymentMethod, label: 'Boleto', flag: '📄', sub: '1–3 dias úteis' },
    ],
    methodLabel: { pix: 'PIX', card: 'Cartão (à vista)', boleto: 'Boleto', zelle: 'Zelle' } as Record<PaymentMethod, string>,
    methodInstruction: {
      pix: 'QR Code PIX',
      card: 'link de pagamento no cartão (à vista, sem parcelamento)',
      boleto: 'boleto',
      zelle: 'dados para transferência Zelle',
    } as Record<PaymentMethod, string>,
    steps: ['Sua conta', 'Pagamento', 'Confirmar'],
    checkoutSecure: 'Checkout seguro',
    loading: 'Carregando...',
    account: {
      title: 'Crie sua conta',
      sub: 'Com esses dados criamos sua empresa na plataforma — você entra direto, sem esperar e-mail.',
      company: 'Nome da empresa *', companyPh: 'Ex: Padaria Estrela',
      name: 'Seu nome *', namePh: 'Ex: Maria Silva',
      email: 'E-mail *', emailPh: 'voce@empresa.com',
      phone: 'WhatsApp / Telefone', phonePh: '+55 11 99999-0000',
      password: 'Crie uma senha de acesso *', passwordPh: 'Mín. 8 caracteres',
      continue: 'Continuar para pagamento',
    },
    payment: {
      title: 'Forma de pagamento',
      boxTitle: 'Acesso liberado na hora',
      boxText: (instruction: string) =>
        `Você entra na plataforma agora e configura seu funcionário digital. As instruções de pagamento (${instruction}) chegam no seu e-mail — e você tem 7 dias de garantia total.`,
      back: 'Voltar',
      review: 'Revisar pedido',
    },
    confirm: {
      title: 'Confirmar pedido',
      company: 'Empresa', name: 'Nome', email: 'E-mail', plan: 'Plano', payment: 'Pagamento', total: 'Total',
      perMonth: '/mês',
      trust: '✓ 7 dias de garantia total  ·  ✓ Cancele quando quiser  ·  ✓ Dados protegidos por SSL',
      back: 'Voltar',
      submit: 'Criar conta e começar',
      submitting: 'Criando sua conta...',
    },
    done: {
      title: 'Conta criada! 🎉',
      sub1: 'Sua empresa ', sub2: ' já está na plataforma.',
      sub3: 'Você tem 7 dias de garantia total. Entrando no painel de configuração…',
      cta: 'Configurar meu funcionário digital',
    },
    summary: {
      eyebrow: 'Resumo do pedido', plan: 'Plano', total: 'Total mensal', taxes: '+ impostos aplicáveis',
      badges: ['Pagamento seguro SSL', 'Acesso imediato', '7 dias de garantia'],
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
    paymentMethods: [
      { id: 'card' as PaymentMethod, label: 'Card', flag: '💳', sub: 'Debit or credit, single charge' },
    ],
    methodLabel: { pix: 'PIX', card: 'Card (single charge)', boleto: 'Boleto', zelle: 'Zelle' } as Record<PaymentMethod, string>,
    methodInstruction: {
      pix: 'PIX QR code',
      card: 'card payment link (single monthly charge, no installments)',
      boleto: 'boleto',
      zelle: 'Zelle transfer details',
    } as Record<PaymentMethod, string>,
    steps: ['Your account', 'Payment', 'Confirm'],
    checkoutSecure: 'Secure checkout',
    loading: 'Loading...',
    account: {
      title: 'Create your account',
      sub: 'We use this to set up your company on the platform — you get in right away, no waiting for emails.',
      company: 'Company name *', companyPh: 'E.g.: Star Bakery',
      name: 'Your name *', namePh: 'E.g.: Mary Smith',
      email: 'Email *', emailPh: 'you@company.com',
      phone: 'WhatsApp / Phone', phonePh: '+1 (555) 000-0000',
      password: 'Create a password *', passwordPh: 'Min. 8 characters',
      continue: 'Continue to payment',
    },
    payment: {
      title: 'Payment method',
      boxTitle: 'Instant access',
      boxText: (instruction: string) =>
        `You get into the platform now and set up your digital employee. Payment instructions (${instruction}) arrive by email — and you have a full 7-day guarantee.`,
      back: 'Back',
      review: 'Review order',
    },
    confirm: {
      title: 'Confirm your order',
      company: 'Company', name: 'Name', email: 'Email', plan: 'Plan', payment: 'Payment', total: 'Total',
      perMonth: '/mo',
      trust: '✓ Full 7-day guarantee  ·  ✓ Cancel anytime  ·  ✓ SSL-protected data',
      back: 'Back',
      submit: 'Create account and start',
      submitting: 'Creating your account...',
    },
    done: {
      title: 'Account created! 🎉',
      sub1: 'Your company ', sub2: ' is on the platform.',
      sub3: 'You have a full 7-day guarantee. Taking you to the setup panel…',
      cta: 'Set up my digital employee',
    },
    summary: {
      eyebrow: 'Order summary', plan: 'Plan', total: 'Monthly total', taxes: '+ applicable taxes',
      badges: ['SSL secure payment', 'Instant access', '7-day guarantee'],
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

function CheckoutForm() {
  const params = useSearchParams()
  const router = useRouter()
  const locale = useLocale()
  const t: Copy = COPY[locale]

  const planSlug = resolvePlan(params.get('plan'))

  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [payMethod, setPayMethod] = useState<PaymentMethod>(locale === 'en' ? 'card' : 'pix')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const [form, setForm] = useState({
    company: '',
    name: '',
    email: '',
    phone: '',
    password: '',
  })

  if (planSlug === 'enterprise') {
    return <EnterpriseContact t={t} />
  }

  const plan = t.plans[planSlug]
  const price = planPrice(planSlug, locale)
  const paymentMethodCount: number = t.paymentMethods.length

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setForm(f => ({ ...f, [e.target.name]: e.target.value }))
  }

  function step1Valid() {
    return form.company.trim() && form.name.trim() && form.email.includes('@') && form.password.length >= 8
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      // 1. Cria de verdade: empresa + unidade + acesso
      const res = await fetch('/api/checkout/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          plan: planSlug,
          locale,
          currency: currencyForLocale(locale),
          paymentMethod: payMethod,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? t.errors.generic)
        setLoading(false)
        return
      }

      // 2. Login automático com a senha que a própria pessoa escolheu
      const supabase = createClient()
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: form.email.trim().toLowerCase(),
        password: form.password,
      })

      setLoading(false)
      setDone(true)

      // Se o login automático falhar (ex.: conta de auth antiga com outra
      // senha), a tela de sucesso orienta a entrar manualmente.
      if (!signInError) {
        setTimeout(() => {
          router.push('/dashboard/onboarding')
          router.refresh()
        }, 1800)
      }
    } catch {
      setError(t.errors.connection)
      setLoading(false)
    }
  }

  if (done) {
    return (
      <div className="flex flex-col items-center gap-6 py-20 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full"
          style={{ background: brandGradient, boxShadow: '0 0 40px rgba(6,182,212,0.4)' }}>
          <Check size={36} className="text-white" />
        </div>
        <div>
          <h2 className="text-3xl font-black text-white">{t.done.title}</h2>
          <p className="mt-3 text-slate-400">
            {t.done.sub1}<strong className="text-white">{form.company}</strong>{t.done.sub2}
          </p>
          <p className="mt-1 text-sm text-slate-500">{t.done.sub3}</p>
        </div>
        <Link
          href="/dashboard/onboarding"
          className="flex items-center gap-2 rounded-2xl px-8 py-4 text-sm font-black text-white"
          style={{ background: brandGradient, boxShadow: '0 6px 20px rgba(6,182,212,0.3)' }}
        >
          {t.done.cta}
          <ArrowRight size={14} />
        </Link>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-5">
      {/* Esquerda — formulário */}
      <div className="lg:col-span-3">
        {/* Etapas */}
        <div className="mb-8 flex items-center gap-3">
          {[1, 2, 3].map(s => (
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
              {s < 3 && <div className="h-px w-8 bg-white/10" />}
            </div>
          ))}
        </div>

        <form onSubmit={handleSubmit}>
          {/* Passo 1 — dados + senha */}
          {step === 1 && (
            <div className="space-y-4">
              <h2 className="text-xl font-black text-white">{t.account.title}</h2>
              <p className="text-sm text-slate-500">{t.account.sub}</p>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label={t.account.company} name="company" value={form.company} onChange={handleChange} placeholder={t.account.companyPh} />
                <Field label={t.account.name} name="name" value={form.name} onChange={handleChange} placeholder={t.account.namePh} />
                <Field label={t.account.email} name="email" type="email" value={form.email} onChange={handleChange} placeholder={t.account.emailPh} />
                <Field label={t.account.phone} name="phone" value={form.phone} onChange={handleChange} placeholder={t.account.phonePh} />
                <Field label={t.account.password} name="password" type="password" value={form.password} onChange={handleChange} placeholder={t.account.passwordPh} />
              </div>

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

              <div className={`grid gap-3 ${
                paymentMethodCount === 1 ? 'grid-cols-1' : paymentMethodCount === 2 ? 'grid-cols-2' : 'grid-cols-3'
              }`}>
                {t.paymentMethods.map(m => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setPayMethod(m.id)}
                    className="flex flex-col items-center gap-1.5 rounded-2xl border p-4 transition-all"
                    style={payMethod === m.id
                      ? { border: '1px solid rgba(6,182,212,0.5)', background: 'rgba(6,182,212,0.1)' }
                      : { border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)' }}
                  >
                    <span className="text-2xl">{m.flag}</span>
                    <span className="text-xs font-black text-white">{m.label}</span>
                    <span className="text-[10px] text-slate-500">{m.sub}</span>
                  </button>
                ))}
              </div>

              <div className="rounded-2xl p-5" style={{ background: 'rgba(6,182,212,0.06)', border: '1px solid rgba(6,182,212,0.2)' }}>
                <p className="flex items-center gap-2 text-sm font-bold text-cyan-300">
                  <CreditCard size={14} /> {t.payment.boxTitle}
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  {t.payment.boxText(t.methodInstruction[payMethod])}
                </p>
              </div>

              <div className="flex gap-3">
                <button type="button" onClick={() => setStep(1)}
                  className="flex-1 rounded-2xl border border-white/10 py-3.5 text-sm font-bold text-slate-400 transition-colors hover:bg-white/5">
                  {t.payment.back}
                </button>
                <button type="button" onClick={() => setStep(3)}
                  className="flex-[2] rounded-2xl py-3.5 text-sm font-black text-white"
                  style={{ background: brandGradient, boxShadow: '0 6px 20px rgba(6,182,212,0.3)' }}>
                  {t.payment.review}
                </button>
              </div>
            </div>
          )}

          {/* Passo 3 — confirmar */}
          {step === 3 && (
            <div className="space-y-5">
              <h2 className="text-xl font-black text-white">{t.confirm.title}</h2>

              <div className="space-y-3 rounded-2xl border border-white/10 p-5" style={{ background: 'rgba(255,255,255,0.03)' }}>
                <Row label={t.confirm.company} value={form.company} />
                <Row label={t.confirm.name} value={form.name} />
                <Row label={t.confirm.email} value={form.email} />
                <Row label={t.confirm.plan} value={`Alizo ${plan.name}`} />
                <Row label={t.confirm.payment} value={t.methodLabel[payMethod]} />
                <div className="border-t border-white/10 pt-3">
                  <Row label={t.confirm.total} value={`${formatPrice(price, locale)}${t.confirm.perMonth}`} highlight />
                </div>
              </div>

              <p className="text-xs text-slate-600">{t.confirm.trust}</p>

              {error && (
                <div className="rounded-xl px-4 py-3" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
                  <p className="text-sm text-red-400">{error}</p>
                </div>
              )}

              <div className="flex gap-3">
                <button type="button" onClick={() => setStep(2)}
                  className="flex-1 rounded-2xl border border-white/10 py-3.5 text-sm font-bold text-slate-400 hover:bg-white/5">
                  {t.confirm.back}
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex flex-[2] items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-black text-white"
                  style={{ background: brandGradient, boxShadow: '0 6px 20px rgba(6,182,212,0.3)' }}
                >
                  {loading ? <Loader2 size={16} className="animate-spin" /> : <Lock size={14} />}
                  {loading ? t.confirm.submitting : t.confirm.submit}
                </button>
              </div>
            </div>
          )}
        </form>
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
