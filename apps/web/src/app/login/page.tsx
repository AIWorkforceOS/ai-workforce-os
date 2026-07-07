'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

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
    <main className="flex min-h-screen bg-[#0a0a0a]">
      {/* Left panel — branding */}
      <div className="hidden flex-col justify-between p-12 lg:flex lg:w-1/2">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-green-500">
            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-white">
              <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8zm1-13h-2v5l4.25 2.55.75-1.23-3-1.82z" />
            </svg>
          </div>
          <span className="text-lg font-semibold text-white">AI Workforce OS</span>
        </div>

        <div>
          <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-green-500/30 bg-green-500/10 px-3 py-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
            <span className="text-xs font-medium text-green-400">Sistema ativo · 100% operacional</span>
          </div>
          <h1 className="text-4xl font-bold leading-tight text-white">
            A força de trabalho<br />
            <span className="text-green-400">inteligente</span> que<br />
            escala com você.
          </h1>
          <p className="mt-4 text-base text-zinc-400">
            Gerencie agentes IA, unidades e resultados em tempo real. Uma plataforma para toda a sua rede de franquias.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Leads gerados', value: '1.200+' },
            { label: 'Conversas/dia', value: '340' },
            { label: 'Taxa de resposta', value: '94%' },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-xl border border-white/10 bg-white/5 p-4">
              <p className="text-2xl font-bold text-white">{value}</p>
              <p className="mt-1 text-xs text-zinc-500">{label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Right panel — login form */}
      <div className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-500">
              <svg viewBox="0 0 24 24" className="h-4 w-4 fill-white">
                <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8zm1-13h-2v5l4.25 2.55.75-1.23-3-1.82z" />
              </svg>
            </div>
            <span className="text-base font-semibold text-white">AI Workforce OS</span>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-8 backdrop-blur-sm">
            <h2 className="text-xl font-semibold text-white">Bem-vindo de volta</h2>
            <p className="mt-1 text-sm text-zinc-400">Entre com suas credenciais de acesso</p>

            <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-zinc-300">E-mail</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder-zinc-600 outline-none transition-colors focus:border-green-500/50 focus:bg-white/8"
                  placeholder="voce@empresa.com"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-zinc-300">Senha</label>
                </div>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder-zinc-600 outline-none transition-colors focus:border-green-500/50"
                  placeholder="••••••••"
                />
              </div>

              {error && (
                <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-2.5">
                  <p className="text-sm text-red-400">{error}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="mt-2 flex items-center justify-center gap-2 rounded-xl bg-green-500 py-3 text-sm font-semibold text-white transition-colors hover:bg-green-400 disabled:opacity-50"
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

          <p className="mt-6 text-center text-xs text-zinc-600">
            Ainda não tem acesso?{' '}
            <a href="/#planos" className="text-zinc-400 hover:text-white">Ver planos disponíveis</a>
          </p>
        </div>
      </div>
    </main>
  )
}
