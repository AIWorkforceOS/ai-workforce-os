'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useLocale } from '@/lib/i18n/client'
import type { Locale } from '@/lib/i18n/config'

const brandGradient = 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)'

const COPY = {
  pt: {
    checking: 'Verificando seu link de acesso...',
    invalidTitle: 'Link inválido ou expirado',
    invalidText: 'Peça um novo link de acesso à equipe Alizo, ou entre com sua senha atual.',
    toLogin: 'Ir para o login',
    title: 'Defina sua senha',
    sub: 'Crie a senha de acesso ao seu painel Alizo.',
    password: 'Nova senha',
    passwordPh: 'Mín. 8 caracteres',
    confirm: 'Confirme a senha',
    confirmPh: 'Repita a senha',
    submit: 'Definir senha e entrar',
    submitting: 'Salvando...',
    tooShort: 'A senha precisa ter pelo menos 8 caracteres.',
    mismatch: 'As senhas não coincidem.',
    genericError: 'Não foi possível definir a senha. Tente novamente.',
    doneTitle: 'Senha definida!',
    doneText: 'Entrando no seu painel...',
  },
  en: {
    checking: 'Checking your access link...',
    invalidTitle: 'Invalid or expired link',
    invalidText: 'Ask the Alizo team for a new access link, or sign in with your current password.',
    toLogin: 'Go to login',
    title: 'Set your password',
    sub: 'Create the password for your Alizo dashboard.',
    password: 'New password',
    passwordPh: 'Min. 8 characters',
    confirm: 'Confirm password',
    confirmPh: 'Repeat the password',
    submit: 'Set password and sign in',
    submitting: 'Saving...',
    tooShort: 'The password must be at least 8 characters long.',
    mismatch: 'Passwords do not match.',
    genericError: 'We could not set your password. Please try again.',
    doneTitle: 'Password set!',
    doneText: 'Taking you to your dashboard...',
  },
} as const satisfies Record<Locale, unknown>

export default function SetPasswordPage() {
  const router = useRouter()
  const locale = useLocale()
  const t = COPY[locale]

  const [status, setStatus] = useState<'checking' | 'ready' | 'invalid'>('checking')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    const supabase = createClient()
    let settled = false

    supabase.auth.getSession().then(({ data }) => {
      if (data.session && !settled) {
        settled = true
        setStatus('ready')
      }
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session && !settled) {
        settled = true
        setStatus('ready')
      }
    })

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true
        setStatus('invalid')
      }
    }, 5000)

    return () => {
      sub.subscription.unsubscribe()
      clearTimeout(timeout)
    }
  }, [])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    if (password.length < 8) {
      setError(t.tooShort)
      return
    }
    if (password !== confirm) {
      setError(t.mismatch)
      return
    }

    setLoading(true)
    const supabase = createClient()
    const { error: updateError } = await supabase.auth.updateUser({ password })
    setLoading(false)
    if (updateError) {
      setError(t.genericError)
      return
    }
    setDone(true)
    setTimeout(() => {
      router.push('/dashboard/onboarding')
      router.refresh()
    }, 1200)
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6" style={{ background: '#0a0f1e' }}>
      <div
        className="w-full max-w-sm rounded-2xl p-8"
        style={{ background: 'rgba(20,26,43,0.7)', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }}
      >
        <img src="/branding/alizo-logo.png" alt="Alizo" className="mb-6 h-8 w-auto" />

        {status === 'checking' && <p className="text-sm text-slate-400">{t.checking}</p>}

        {status === 'invalid' && (
          <>
            <h1 className="text-lg font-black text-white">{t.invalidTitle}</h1>
            <p className="mt-2 text-sm text-slate-400">{t.invalidText}</p>
            <a href="/login" className="mt-4 inline-block text-sm font-semibold text-cyan-400">{t.toLogin}</a>
          </>
        )}

        {status === 'ready' && !done && (
          <>
            <h1 className="text-lg font-black text-white">{t.title}</h1>
            <p className="mt-1 text-sm text-slate-400">{t.sub}</p>
            <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-slate-300">{t.password}</label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="rounded-xl px-4 py-3 text-sm text-white placeholder-slate-600 outline-none transition-colors focus:border-cyan-500/50"
                  style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
                  placeholder={t.passwordPh}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-slate-300">{t.confirm}</label>
                <input
                  type="password"
                  required
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="rounded-xl px-4 py-3 text-sm text-white placeholder-slate-600 outline-none transition-colors focus:border-cyan-500/50"
                  style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
                  placeholder={t.confirmPh}
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
                style={{ background: brandGradient, boxShadow: '0 4px 14px rgba(6,182,212,0.3)' }}
              >
                {loading ? t.submitting : t.submit}
              </button>
            </form>
          </>
        )}

        {done && (
          <>
            <h1 className="text-lg font-black text-white">{t.doneTitle}</h1>
            <p className="mt-2 text-sm text-slate-400">{t.doneText}</p>
          </>
        )}
      </div>
    </main>
  )
}
