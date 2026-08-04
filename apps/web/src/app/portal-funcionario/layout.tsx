import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getAppUser } from '@/lib/app-user'
import { SignOutButton } from '@/components/dashboard/sign-out-button'

export default async function PortalFuncionarioLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const appUser = await getAppUser()

  if (!appUser) {
    return (
      <div className="flex h-screen items-center justify-center" style={{ background: '#0a0f1e' }}>
        <div
          className="mx-4 max-w-md rounded-2xl p-8 text-center"
          style={{ background: '#141a2b', boxShadow: '0 1px 3px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.06)' }}
        >
          <h1 className="text-lg font-black text-white">Acesso não provisionado</h1>
          <p className="mt-2 text-sm text-slate-400">
            Sua conta <span className="font-semibold text-slate-200">{user.email}</span> foi autenticada, mas
            ainda não está vinculada a nenhum funcionário. Fale com a sua empresa para liberar o acesso.
          </p>
          <div className="mt-6">
            <SignOutButton />
          </div>
        </div>
      </div>
    )
  }

  // Esta área é exclusiva de contas de funcionário — o resto da equipe usa
  // /dashboard (guarda simétrica em dashboard/layout.tsx, que manda
  // role='employee' para cá).
  if (appUser.role !== 'employee') {
    redirect('/dashboard')
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden" style={{ background: '#0a0f1e' }}>
      <header
        className="sticky top-0 z-30 flex h-14 flex-shrink-0 items-center justify-between px-4 sm:px-6"
        style={{
          background: 'rgba(10,15,30,0.9)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
        }}
      >
        <div className="flex items-center gap-2">
          <img src="/branding/alizo-icon.png" alt="Alizo" className="h-6 w-auto" />
          <p className="text-[14px] font-black tracking-tight text-white">alizo</p>
          <span style={{ color: 'rgba(255,255,255,0.2)' }}>/</span>
          <span
            className="rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider"
            style={{ background: 'rgba(6,182,212,0.15)', color: '#06b6d4' }}
          >
            Portal do Funcionário
          </span>
        </div>

        <div className="flex items-center gap-3">
          <span className="hidden max-w-[200px] truncate text-[13px] font-semibold text-slate-300 sm:inline">
            {appUser.name ?? appUser.email}
          </span>
          <SignOutButton />
        </div>
      </header>

      <main
        className="flex-1 overflow-y-auto"
        style={{
          background: 'radial-gradient(ellipse 70% 40% at 50% -5%, rgba(67,97,238,0.08) 0%, transparent 60%), #0a0f1e',
        }}
      >
        <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">{children}</div>
      </main>
    </div>
  )
}
