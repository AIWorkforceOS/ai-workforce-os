'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Bot, MessageSquare, TrendingUp, Zap } from 'lucide-react'

export default function LoginPage() {
  const router = useRouter()
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
    if (signInError) { setError('E-mail ou senha inválidos.'); return }
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

        <img src="/branding/alizo-logo.png" alt="Alizo" className="relative h-9 w-auto" />

        <div className="relative">
          <div
            className="mb-8 inline-flex items-center gap-2 rounded-full px-3 py-1.5"
            style={{ background: 'rgba(6,182,212,0.1)', border: '1px solid rgba(6,182,212,0.25)' }}
          >
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-50" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-cyan-400" />
            </span>
            <span className="text-xs font-semibold" style={{ color: '#67e8f9' }}>Sistema ativo · 100% operacional</span>
          </div>
          <h1 className="text-4xl font-black leading-tight tracking-tight text-white">
            A força de trabalho<br />
            <span
              style={{
                background: 'linear-gradient(135deg, #22d3ee 0%, #818cf8 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              inteligente
            </span> que<br />
            escala com você.
          </h1>
          <p className="mt-4 max-w-sm text-base text-slate-400">
            Seus funcionários digitais atendem, vendem e recrutam por você — e aqui você acompanha tudo em tempo real.
          </p>

          <div className="mt-8 grid grid-cols-2 gap-3 max-w-sm">
            {[
              { icon: Bot, label: 'Agentes IA 24/7' },
              { icon: MessageSquare, label: 'WhatsApp integrado' },
              { icon: TrendingUp, label: 'CRM em tempo real' },
              { icon: Zap, label: 'Onboarding automático' },
            ].map(({ icon: Icon, label }) => (
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
            ))}
          </div>
        </div>

        <div className="relative grid grid-cols-3 gap-4">
          {[
            { label: 'Leads gerados', value: '1.200+' },
            { label: 'Conversas/dia', value: '340' },
            { label: 'Taxa de resposta', value: '94%' },
          ].map(({ label, value }) => (
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
            <h2 className="text-xl font-black tracking-tight text-white">Bem-vindo de volta</h2>
            <p className="mt-1 text-sm text-slate-400">Entre com suas credenciais de acesso</p>

            <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-slate-300">E-mail</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="rounded-xl px-4 py-3 text-sm text-white placeholder-slate-600 outline-none transition-colors focus:border-cyan-500/50"
                  style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
                  placeholder="voce@empresa.com"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-slate-300">Senha</label>
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
                    Entrando...
                  </>
                ) : 'Acessar painel'}
              </button>
            </form>
          </div>

          <p className="mt-6 text-center text-xs text-slate-600">
            Ainda não tem acesso?{' '}
            <a href="/#planos" className="text-slate-400 hover:text-cyan-400">Ver planos disponíveis</a>
          </p>
        </div>
      </div>
    </main>
  )
}
