'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useLocale } from '@/lib/i18n/client'
import type { Locale } from '@/lib/i18n/config'
import { Bot, MessageSquare, TrendingUp, Zap } from 'lucide-react'

const COPY = {
  pt: {
    badge: 'Sistema ativo · 100% operacional',
    titleA: 'A força de trabalho',
    titleGrad: 'inteligente',
    titleB: ' que',
    titleC: 'escala com você.',
    sub: 'Seus funcionários digitais atendem, vendem e recrutam por você — e aqui você acompanha tudo em tempo real.',
    chips: ['Agentes IA 24/7', 'WhatsApp integrado', 'CRM em tempo real', 'Onboarding automático'],
    stats: [
      { label: 'Funcionários digitais', value: '3' },
      { label: 'Disponibilidade', value: '24/7' },
      { label: 'Para ativar', value: '10 min' },
    ],
    welcome: 'Bem-vindo de volta',
    welcomeSub: 'Entre com suas credenciais de acesso',
    email: 'E-mail',
    emailPh: 'voce@empresa.com',
    password: 'Senha',
    invalid: 'E-mail ou senha inválidos.',
    signingIn: 'Entrando...',
    signIn: 'Acessar painel',
    noAccess: 'Ainda não tem acesso?',
    seePlans: 'Ver planos disponíveis',
  },
  en: {
    badge: 'System live · fully operational',
    titleA: 'The intelligent',
    titleGrad: 'workforce',
    titleB: ' that',
    titleC: 'scales with you.',
    sub: 'Your digital employees answer, sell and recruit for you — and here you track everything in real time.',
    chips: ['AI agents 24/7', 'WhatsApp integrated', 'Real-time CRM', 'Automatic onboarding'],
    stats: [
      { label: 'Digital employees', value: '3' },
      { label: 'Availability', value: '24/7' },
      { label: 'To go live', value: '10 min' },
    ],
    welcome: 'Welcome back',
    welcomeSub: 'Sign in with your credentials',
    email: 'Email',
    emailPh: 'you@company.com',
    password: 'Password',
    invalid: 'Invalid email or password.',
    signingIn: 'Signing in...',
    signIn: 'Open dashboard',
    noAccess: "Don't have access yet?",
    seePlans: 'See available plans',
  },
} as const satisfies Record<Locale, unknown>

export default function LoginPage() {
  const router = useRouter()
  const locale = useLocale()
  const t = COPY[locale]
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setLoading(true)
    const supabase = createClient()
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)
    if (signInError) { setError(t.invalid); return }
    router.push('/dashboard')
    router.refresh()
  }

  return (
    <main
      className="flex min-h-screen"
      style={{
        background:
          'radial-gradient(ellipse 80% 50% at 15% 0%, rgba(6,182,212,0.16) 0%, transparent 60%), radial-gradient(ellipse 60% 50% at 100% 100%, rgba(67,97,238,0.14) 0%, transparent 60%), #0a0f1e',
      }}
    >
      {/* Left panel — branding */}
      <div className="relative hidden flex-col justify-between overflow-hidden p-12 lg:flex lg:w-1/2">
        {/* Decorative glow */}
        <div
          className="pointer-events-none absolute -left-24 -top-24 h-96 w-96 rounded-full blur-3xl"
          style={{ background: 'radial-gradient(circle, rgba(6,182,212,0.25) 0%, transparent 70%)' }}
        />
        <div
          className="pointer-events-none absolute -bottom-32 -right-10 h-96 w-96 rounded-full blur-3xl"
          style={{ background: 'radial-gradient(circle, rgba(67,97,238,0.2) 0%, transparent 70%)' }}
        />

        <img src="/branding/alizo-logo.png" alt="Alizo" className="relative h-9 w-auto self-start" />

        <div className="relative">
          <div
            className="mb-8 inline-flex items-center gap-2 rounded-full px-3 py-1.5"
            style={{ background: 'rgba(6,182,212,0.1)', border: '1px solid rgba(6,182,212,0.25)' }}
          >
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-50" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-cyan-400" />
            </span>
            <span className="text-xs font-semibold" style={{ color: '#67e8f9' }}>{t.badge}</span>
          </div>
          <h1 className="text-4xl font-black leading-tight tracking-tight text-white">
            {t.titleA}<br />
            <span
              style={{
                background: 'linear-gradient(135deg, #22d3ee 0%, #818cf8 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              {t.titleGrad}
            </span>{t.titleB}<br />
            {t.titleC}
          </h1>
          <p className="mt-4 max-w-sm text-base text-slate-400">
            {t.sub}
          </p>

          <div className="mt-8 grid grid-cols-2 gap-3 max-w-sm">
            {t.chips.map((label, i) => {
              const Icon = [Bot, MessageSquare, TrendingUp, Zap][i]!
              return (
              <div
                key={label}
                className="flex items-center gap-2.5 rounded-xl px-3.5 py-3"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
              >
                <div
                  className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg"
                  style={{ background: 'linear-gradient(135deg, rgba(6,182,212,0.2), rgba(67,97,238,0.2))' }}
                >
                  <Icon size={13} className="text-cyan-400" />
                </div>
                <span className="text-xs font-semibold text-slate-300">{label}</span>
              </div>
              )
            })}
          </div>
        </div>

        <div className="relative grid grid-cols-3 gap-4">
          {t.stats.map(({ label, value }) => (
            <div key={label} className="rounded-xl p-4" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <p className="text-2xl font-black text-white">{value}</p>
              <p className="mt-1 text-xs text-slate-500">{label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Right panel — login form */}
      <div className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="mb-8 flex justify-center lg:hidden">
            <img src="/branding/alizo-logo.png" alt="Alizo" className="h-8 w-auto" />
          </div>

          <div
            className="rounded-2xl p-8 backdrop-blur-sm"
            style={{ background: 'rgba(20,26,43,0.7)', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }}
          >
            <h2 className="text-xl font-black tracking-tight text-white">{t.welcome}</h2>
            <p className="mt-1 text-sm text-slate-400">{t.welcomeSub}</p>

            <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-slate-300">{t.email}</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="rounded-xl px-4 py-3 text-sm text-white placeholder-slate-600 outline-none transition-colors focus:border-cyan-500/50"
                  style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
                  placeholder={t.emailPh}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-slate-300">{t.password}</label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="rounded-xl px-4 py-3 text-sm text-white placeholder-slate-600 outline-none transition-colors focus:border-cyan-500/50"
                  style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
                  placeholder="••••••••"
                />
              </div>

              {error && (
                <div className="rounded-lg px-4 py-2.5" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
                  <p className="text-sm text-red-400">{error}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="mt-2 flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold text-white transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)', boxShadow: '0 4px 14px rgba(6,182,212,0.3)' }}
              >
                {loading ? (
                  <>
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                    {t.signingIn}
                  </>
                ) : t.signIn}
              </button>
            </form>
          </div>

          <p className="mt-6 text-center text-xs text-slate-600">
            {t.noAccess}{' '}
            <a href="/#planos" className="text-slate-400 hover:text-cyan-400">{t.seePlans}</a>
          </p>
        </div>
      </div>
    </main>
  )
}
