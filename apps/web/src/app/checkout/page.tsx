'use client'

import { useState, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Check, CreditCard, Zap, Lock, ArrowRight, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

const brandGradient = 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)'

const PLANS = {
  starter: {
    name: 'Básico',
    price: 297,
    features: ['1 unidade', '1 funcionário digital', '500 leads/mês', 'Suporte por e-mail'],
  },
  pro: {
    name: 'Pro',
    price: 597,
    features: ['5 unidades', '3 funcionários digitais', '2.000 leads/mês', 'Suporte prioritário', 'Configuração assistida'],
  },
  enterprise: {
    name: 'Enterprise',
    price: 1497,
    features: ['Unidades ilimitadas', 'Funcionários ilimitados', 'Leads ilimitados', 'Gerente de conta', 'SLA garantido'],
  },
} as const

type PlanSlug = keyof typeof PLANS

/** aceita os slugs antigos do site (basico) e novos (starter) */
function resolvePlan(param: string | null): PlanSlug {
  if (param === 'basico' || param === 'starter') return 'starter'
  if (param === 'pro') return 'pro'
  if (param === 'enterprise') return 'enterprise'
  return 'starter'
}

type PaymentMethod = 'card' | 'pix' | 'boleto'

function CheckoutForm() {
  const params = useSearchParams()
  const router = useRouter()
  const planSlug = resolvePlan(params.get('plan'))
  const plan = PLANS[planSlug]

  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [payMethod, setPayMethod] = useState<PaymentMethod>('pix')
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
        body: JSON.stringify({ ...form, plan: planSlug }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Não foi possível concluir seu cadastro. Tente novamente.')
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
      setError('Falha de conexão. Verifique sua internet e tente novamente.')
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
          <h2 className="text-3xl font-black text-white">Conta criada! 🎉</h2>
          <p className="mt-3 text-slate-400">
            Sua empresa <strong className="text-white">{form.company}</strong> já está na plataforma.
          </p>
          <p className="mt-1 text-sm text-slate-500">
            Você tem 7 dias de garantia total. Entrando no painel de configuração…
          </p>
        </div>
        <Link
          href="/dashboard/onboarding"
          className="flex items-center gap-2 rounded-2xl px-8 py-4 text-sm font-black text-white"
          style={{ background: brandGradient, boxShadow: '0 6px 20px rgba(6,182,212,0.3)' }}
        >
          Configurar meu funcionário digital
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
                {s === 1 ? 'Sua conta' : s === 2 ? 'Pagamento' : 'Confirmar'}
              </span>
              {s < 3 && <div className="h-px w-8 bg-white/10" />}
            </div>
          ))}
        </div>

        <form onSubmit={handleSubmit}>
          {/* Passo 1 — dados + senha */}
          {step === 1 && (
            <div className="space-y-4">
              <h2 className="text-xl font-black text-white">Crie sua conta</h2>
              <p className="text-sm text-slate-500">
                Com esses dados criamos sua empresa na plataforma — você entra direto, sem esperar e-mail.
              </p>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Nome da empresa *" name="company" value={form.company} onChange={handleChange} placeholder="Ex: Padaria Estrela" />
                <Field label="Seu nome *" name="name" value={form.name} onChange={handleChange} placeholder="Ex: Maria Silva" />
                <Field label="E-mail *" name="email" type="email" value={form.email} onChange={handleChange} placeholder="voce@empresa.com" />
                <Field label="WhatsApp / Telefone" name="phone" value={form.phone} onChange={handleChange} placeholder="+55 11 99999-0000" />
                <Field label="Crie uma senha de acesso *" name="password" type="password" value={form.password} onChange={handleChange} placeholder="Mín. 8 caracteres" />
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
                Continuar para pagamento
                <ArrowRight size={14} />
              </button>
            </div>
          )}

          {/* Passo 2 — pagamento */}
          {step === 2 && (
            <div className="space-y-5">
              <h2 className="text-xl font-black text-white">Forma de pagamento</h2>

              <div className="grid grid-cols-3 gap-3">
                {([
                  { id: 'pix', label: 'PIX', flag: '⚡', sub: 'Aprovação imediata' },
                  { id: 'card', label: 'Cartão', flag: '💳', sub: 'Crédito ou débito' },
                  { id: 'boleto', label: 'Boleto', flag: '📄', sub: '1–3 dias úteis' },
                ] as { id: PaymentMethod; label: string; flag: string; sub: string }[]).map(m => (
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
                  <CreditCard size={14} /> Acesso liberado na hora
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  Você entra na plataforma agora e configura seu funcionário digital. As instruções de
                  pagamento ({payMethod === 'pix' ? 'QR Code PIX' : payMethod === 'card' ? 'cartão' : 'boleto'})
                  chegam no seu e-mail — e você tem 7 dias de garantia total.
                </p>
              </div>

              <div className="flex gap-3">
                <button type="button" onClick={() => setStep(1)}
                  className="flex-1 rounded-2xl border border-white/10 py-3.5 text-sm font-bold text-slate-400 transition-colors hover:bg-white/5">
                  Voltar
                </button>
                <button type="button" onClick={() => setStep(3)}
                  className="flex-[2] rounded-2xl py-3.5 text-sm font-black text-white"
                  style={{ background: brandGradient, boxShadow: '0 6px 20px rgba(6,182,212,0.3)' }}>
                  Revisar pedido
                </button>
              </div>
            </div>
          )}

          {/* Passo 3 — confirmar */}
          {step === 3 && (
            <div className="space-y-5">
              <h2 className="text-xl font-black text-white">Confirmar pedido</h2>

              <div className="space-y-3 rounded-2xl border border-white/10 p-5" style={{ background: 'rgba(255,255,255,0.03)' }}>
                <Row label="Empresa" value={form.company} />
                <Row label="Nome" value={form.name} />
                <Row label="E-mail" value={form.email} />
                <Row label="Plano" value={`Alizo ${plan.name}`} />
                <Row label="Pagamento" value={{ card: 'Cartão de crédito', pix: 'PIX', boleto: 'Boleto' }[payMethod]} />
                <div className="border-t border-white/10 pt-3">
                  <Row label="Total" value={`R$ ${plan.price.toLocaleString('pt-BR')}/mês`} highlight />
                </div>
              </div>

              <p className="text-xs text-slate-600">
                ✓ 7 dias de garantia total &nbsp;·&nbsp; ✓ Cancele quando quiser &nbsp;·&nbsp; ✓ Dados protegidos por SSL
              </p>

              {error && (
                <div className="rounded-xl px-4 py-3" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
                  <p className="text-sm text-red-400">{error}</p>
                </div>
              )}

              <div className="flex gap-3">
                <button type="button" onClick={() => setStep(2)}
                  className="flex-1 rounded-2xl border border-white/10 py-3.5 text-sm font-bold text-slate-400 hover:bg-white/5">
                  Voltar
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex flex-[2] items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-black text-white"
                  style={{ background: brandGradient, boxShadow: '0 6px 20px rgba(6,182,212,0.3)' }}
                >
                  {loading ? <Loader2 size={16} className="animate-spin" /> : <Lock size={14} />}
                  {loading ? 'Criando sua conta...' : 'Criar conta e começar'}
                </button>
              </div>
            </div>
          )}
        </form>
      </div>

      {/* Direita — resumo */}
      <div className="lg:col-span-2">
        <div className="sticky top-24 rounded-3xl border border-white/10 p-6" style={{ background: 'rgba(255,255,255,0.03)' }}>
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Resumo do pedido</p>
          <div className="mt-4 flex items-center gap-3">
            <img src="/branding/alizo-icon.png" alt="Alizo" className="h-10 w-auto" />
            <div>
              <p className="text-sm font-black text-white">alizo</p>
              <p className="text-xs text-slate-500">Plano {plan.name}</p>
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
              <span className="text-sm text-slate-500">Total mensal</span>
              <span className="text-2xl font-black text-white">R$ {plan.price.toLocaleString('pt-BR')}</span>
            </div>
            <p className="mt-1 text-right text-xs text-slate-600">+ impostos aplicáveis</p>
          </div>

          <div className="mt-5 space-y-2">
            {[
              { icon: Lock, text: 'Pagamento seguro SSL' },
              { icon: Zap, text: 'Acesso imediato' },
              { icon: Check, text: '7 dias de garantia' },
            ].map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-center gap-2 text-xs text-slate-500">
                <Icon size={12} className="text-cyan-400" />
                {text}
              </div>
            ))}
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
            Checkout seguro
          </div>
        </div>
      </nav>

      <div className="mx-auto max-w-5xl px-6 py-10">
        <Suspense fallback={<div className="text-sm text-slate-500">Carregando...</div>}>
          <CheckoutForm />
        </Suspense>
      </div>
    </div>
  )
}
