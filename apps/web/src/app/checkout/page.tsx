'use client'

import { useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Bot, Check, CreditCard, Zap, Lock, ArrowRight, Loader2 } from 'lucide-react'

const PLANS = {
  starter: {
    name: 'Starter',
    price: 297,
    features: ['1 unidade', '1 agente IA', '500 leads/mês', 'Suporte por e-mail'],
  },
  pro: {
    name: 'Pro',
    price: 597,
    features: ['5 unidades', '3 agentes IA', '2.000 leads/mês', 'Suporte prioritário', 'Config. feita por nós'],
  },
  enterprise: {
    name: 'Enterprise',
    price: 1497,
    features: ['Unidades ilimitadas', 'Agentes ilimitados', 'Leads ilimitados', 'Gerente de conta', 'SLA garantido'],
  },
} as const

type PlanSlug = keyof typeof PLANS

type PaymentMethod = 'card' | 'pix' | 'boleto' | 'zelle'

function CheckoutForm() {
  const params = useSearchParams()
  const planSlug = (params.get('plan') as PlanSlug) ?? 'starter'
  const plan = PLANS[planSlug] ?? PLANS.starter

  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [payMethod, setPayMethod] = useState<PaymentMethod>('pix')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  const [form, setForm] = useState({
    company: '',
    name: '',
    email: '',
    phone: '',
    country: 'BR',
    password: '',
  })

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    setForm(f => ({ ...f, [e.target.name]: e.target.value }))
  }

  function step1Valid() {
    return form.company.trim() && form.name.trim() && form.email.includes('@')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)

    // TODO: Integrate Stripe Checkout Session here
    // const res = await fetch('/api/checkout/create-session', {
    //   method: 'POST',
    //   body: JSON.stringify({ plan: planSlug, ...form, payMethod }),
    // })
    // const { url } = await res.json()
    // window.location.href = url  ← redirect to Stripe

    // Simulating for now
    await new Promise(r => setTimeout(r, 2000))
    setLoading(false)
    setDone(true)
  }

  if (done) {
    return (
      <div className="flex flex-col items-center gap-6 py-20 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full"
          style={{ background: 'linear-gradient(135deg, #22c55e, #16a34a)', boxShadow: '0 0 40px rgba(34,197,94,0.4)' }}>
          <Check size={36} className="text-white" />
        </div>
        <div>
          <h2 className="text-3xl font-black text-white">Pagamento confirmado! 🎉</h2>
          <p className="mt-3 text-zinc-400">
            Enviamos as credenciais de acesso para <strong className="text-white">{form.email}</strong>
          </p>
          <p className="mt-1 text-sm text-zinc-500">Verifique sua caixa de entrada (e o spam, só por garantia)</p>
        </div>
        <Link
          href="/dashboard/onboarding"
          className="flex items-center gap-2 rounded-2xl px-8 py-4 text-sm font-black text-white"
          style={{ background: 'linear-gradient(135deg, #22c55e, #16a34a)', boxShadow: '0 6px 20px rgba(34,197,94,0.3)' }}
        >
          Configurar meu funcionário IA agora
          <ArrowRight size={14} />
        </Link>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-5">
      {/* Left — form */}
      <div className="lg:col-span-3">
        {/* Steps */}
        <div className="mb-8 flex items-center gap-3">
          {[1, 2, 3].map(s => (
            <div key={s} className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-black transition-all"
                style={step >= s
                  ? { background: 'linear-gradient(135deg, #22c55e, #16a34a)', color: '#fff' }
                  : { background: 'rgba(255,255,255,0.06)', color: '#52525b' }}>
                {step > s ? <Check size={12} /> : s}
              </div>
              <span className="text-xs font-semibold" style={{ color: step >= s ? '#d4d4d8' : '#52525b' }}>
                {s === 1 ? 'Dados da empresa' : s === 2 ? 'Pagamento' : 'Confirmar'}
              </span>
              {s < 3 && <div className="h-px w-8 bg-white/10" />}
            </div>
          ))}
        </div>

        <form onSubmit={handleSubmit}>
          {/* Step 1 — Company info */}
          {step === 1 && (
            <div className="space-y-4">
              <h2 className="text-xl font-black text-white">Dados da sua empresa</h2>
              <p className="text-sm text-zinc-500">Usaremos para configurar seu funcionário IA e criar sua conta</p>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Nome da empresa *" name="company" value={form.company} onChange={handleChange} placeholder="Ex: Rede Smarter" />
                <Field label="Seu nome *" name="name" value={form.name} onChange={handleChange} placeholder="Ex: Ricardo Silva" />
                <Field label="E-mail *" name="email" type="email" value={form.email} onChange={handleChange} placeholder="voce@empresa.com" />
                <Field label="WhatsApp / Telefone" name="phone" value={form.phone} onChange={handleChange} placeholder="+55 11 99999-0000" />
                <div>
                  <label className="mb-1.5 block text-xs font-bold text-zinc-400">País</label>
                  <select
                    name="country"
                    value={form.country}
                    onChange={handleChange}
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none focus:border-green-500/50"
                  >
                    <option value="BR">🇧🇷 Brasil</option>
                    <option value="US">🇺🇸 United States</option>
                  </select>
                </div>
                <Field label="Senha de acesso *" name="password" type="password" value={form.password} onChange={handleChange} placeholder="Mín. 8 caracteres" />
              </div>

              <button
                type="button"
                onClick={() => step1Valid() && setStep(2)}
                disabled={!step1Valid()}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-sm font-black text-white transition-all"
                style={step1Valid()
                  ? { background: 'linear-gradient(135deg, #22c55e, #16a34a)', boxShadow: '0 6px 20px rgba(34,197,94,0.3)' }
                  : { background: 'rgba(255,255,255,0.06)', color: '#52525b', cursor: 'not-allowed' }}
              >
                Continuar para pagamento
                <ArrowRight size={14} />
              </button>
            </div>
          )}

          {/* Step 2 — Payment */}
          {step === 2 && (
            <div className="space-y-5">
              <h2 className="text-xl font-black text-white">Forma de pagamento</h2>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {([
                  { id: 'pix', label: 'PIX', flag: '🔥', sub: 'Aprovação imediata', countries: ['BR'] },
                  { id: 'card', label: 'Cartão', flag: '💳', sub: 'Crédito ou débito', countries: ['BR', 'US'] },
                  { id: 'boleto', label: 'Boleto', flag: '📄', sub: '1–3 dias úteis', countries: ['BR'] },
                  { id: 'zelle', label: 'Zelle', flag: '🇺🇸', sub: 'EUA apenas', countries: ['US'] },
                ] satisfies { id: string; label: string; flag: string; sub: string; countries: string[] }[]).filter(m => m.countries.includes(form.country)).map(m => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setPayMethod(m.id as PaymentMethod)}
                    className="flex flex-col items-center gap-1.5 rounded-2xl border p-4 transition-all"
                    style={payMethod === m.id
                      ? { border: '1px solid rgba(34,197,94,0.5)', background: 'rgba(34,197,94,0.1)' }
                      : { border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)' }}
                  >
                    <span className="text-2xl">{m.flag}</span>
                    <span className="text-xs font-black text-white">{m.label}</span>
                    <span className="text-[10px] text-zinc-500">{m.sub}</span>
                  </button>
                ))}
              </div>

              {payMethod === 'pix' && (
                <div className="rounded-2xl border border-green-500/20 p-5" style={{ background: 'rgba(34,197,94,0.06)' }}>
                  <p className="text-sm font-bold text-green-400">✓ Aprovação instantânea com PIX</p>
                  <p className="mt-1 text-xs text-zinc-500">Ao clicar em confirmar, você recebe o QR Code do PIX. Após confirmação automática do pagamento, seu acesso é liberado em segundos.</p>
                </div>
              )}
              {payMethod === 'card' && (
                <div className="rounded-2xl border border-white/10 p-5" style={{ background: 'rgba(255,255,255,0.03)' }}>
                  <p className="text-sm font-bold text-white flex items-center gap-2"><CreditCard size={14} /> Cartão de crédito ou débito</p>
                  <p className="mt-1 text-xs text-zinc-500">Processado com segurança via Stripe. Aceitamos Visa, Mastercard, Amex. Parcelamento disponível.</p>
                </div>
              )}
              {payMethod === 'zelle' && (
                <div className="rounded-2xl border border-blue-500/20 p-5" style={{ background: 'rgba(59,130,246,0.06)' }}>
                  <p className="text-sm font-bold text-blue-400">🇺🇸 Zelle — EUA</p>
                  <p className="mt-1 text-xs text-zinc-500">Envie para <strong className="text-white">payments@aiworkforce.com</strong>. Após confirmação (geralmente 1h), seu acesso é liberado manualmente. Mencione seu e-mail no comentário.</p>
                </div>
              )}

              <div className="flex gap-3">
                <button type="button" onClick={() => setStep(1)}
                  className="flex-1 rounded-2xl border border-white/10 py-3.5 text-sm font-bold text-zinc-400 transition-colors hover:bg-white/5">
                  Voltar
                </button>
                <button type="button" onClick={() => setStep(3)}
                  className="flex-[2] rounded-2xl py-3.5 text-sm font-black text-white"
                  style={{ background: 'linear-gradient(135deg, #22c55e, #16a34a)', boxShadow: '0 6px 20px rgba(34,197,94,0.3)' }}>
                  Revisar pedido
                </button>
              </div>
            </div>
          )}

          {/* Step 3 — Confirm */}
          {step === 3 && (
            <div className="space-y-5">
              <h2 className="text-xl font-black text-white">Confirmar pedido</h2>

              <div className="space-y-3 rounded-2xl border border-white/10 p-5" style={{ background: 'rgba(255,255,255,0.03)' }}>
                <Row label="Empresa" value={form.company} />
                <Row label="Nome" value={form.name} />
                <Row label="E-mail" value={form.email} />
                <Row label="Plano" value={`AI Workforce OS ${plan.name}`} />
                <Row label="Pagamento" value={{ card: 'Cartão de crédito', pix: 'PIX', boleto: 'Boleto', zelle: 'Zelle' }[payMethod]} />
                <div className="border-t border-white/10 pt-3">
                  <Row label="Total" value={`R$ ${plan.price.toLocaleString('pt-BR')}/mês`} highlight />
                </div>
              </div>

              <p className="text-xs text-zinc-600">
                ✓ 7 dias de garantia total &nbsp;·&nbsp; ✓ Cancele quando quiser &nbsp;·&nbsp; ✓ Dados protegidos por SSL
              </p>

              <div className="flex gap-3">
                <button type="button" onClick={() => setStep(2)}
                  className="flex-1 rounded-2xl border border-white/10 py-3.5 text-sm font-bold text-zinc-400 hover:bg-white/5">
                  Voltar
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex flex-[2] items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-black text-white"
                  style={{ background: 'linear-gradient(135deg, #22c55e, #16a34a)', boxShadow: '0 6px 20px rgba(34,197,94,0.3)' }}
                >
                  {loading ? <Loader2 size={16} className="animate-spin" /> : <Lock size={14} />}
                  {loading ? 'Processando...' : `Pagar R$ ${plan.price.toLocaleString('pt-BR')}`}
                </button>
              </div>
            </div>
          )}
        </form>
      </div>

      {/* Right — order summary */}
      <div className="lg:col-span-2">
        <div className="sticky top-24 rounded-3xl border border-white/10 p-6" style={{ background: 'rgba(255,255,255,0.03)' }}>
          <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Resumo do pedido</p>
          <div className="mt-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl"
              style={{ background: 'linear-gradient(135deg, #22c55e, #16a34a)' }}>
              <Bot size={18} className="text-white" />
            </div>
            <div>
              <p className="text-sm font-black text-white">AI Workforce OS</p>
              <p className="text-xs text-zinc-500">Plano {plan.name}</p>
            </div>
          </div>

          <div className="mt-5 space-y-2.5">
            {plan.features.map(f => (
              <div key={f} className="flex items-center gap-2.5 text-sm text-zinc-400">
                <Check size={13} className="text-green-400 flex-shrink-0" />
                {f}
              </div>
            ))}
          </div>

          <div className="mt-5 border-t border-white/10 pt-5">
            <div className="flex items-end justify-between">
              <span className="text-sm text-zinc-500">Total mensal</span>
              <span className="text-2xl font-black text-white">R$ {plan.price.toLocaleString('pt-BR')}</span>
            </div>
            <p className="mt-1 text-right text-xs text-zinc-600">+ impostos aplicáveis</p>
          </div>

          <div className="mt-5 space-y-2">
            {[
              { icon: Lock, text: 'Pagamento seguro SSL' },
              { icon: Zap, text: 'Acesso imediato' },
              { icon: Check, text: '7 dias de garantia' },
            ].map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-center gap-2 text-xs text-zinc-500">
                <Icon size={12} className="text-green-400" />
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
      <label className="mb-1.5 block text-xs font-bold text-zinc-400">{label}</label>
      <input
        type={type}
        name={name}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder-zinc-600 outline-none transition-colors focus:border-green-500/50"
      />
    </div>
  )
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-zinc-500">{label}</span>
      <span className={`text-sm font-bold ${highlight ? 'text-green-400' : 'text-white'}`}>{value}</span>
    </div>
  )
}

export default function CheckoutPage() {
  return (
    <div className="min-h-screen" style={{ background: '#06090f', color: '#fff' }}>
      {/* Nav */}
      <nav className="border-b border-white/[0.06] px-6 py-4" style={{ background: 'rgba(6,9,15,0.9)' }}>
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg"
              style={{ background: 'linear-gradient(135deg, #22c55e, #16a34a)' }}>
              <Bot size={13} className="text-white" />
            </div>
            <span className="text-sm font-black text-white">AI Workforce <span style={{ color: '#22c55e' }}>OS</span></span>
          </Link>
          <div className="flex items-center gap-1.5 text-xs text-zinc-500">
            <Lock size={11} />
            Checkout seguro
          </div>
        </div>
      </nav>

      <div className="mx-auto max-w-5xl px-6 py-10">
        <Suspense fallback={<div className="text-zinc-500 text-sm">Carregando...</div>}>
          <CheckoutForm />
        </Suspense>
      </div>
    </div>
  )
}
