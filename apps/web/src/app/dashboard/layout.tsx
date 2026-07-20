import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getAppUser, ROLE_LABEL, type AppRole } from '@/lib/app-user'
import { getLocale } from '@/lib/i18n/server'
import { Sidebar } from '@/components/dashboard/sidebar'
import { MobileSidebar } from '@/components/dashboard/mobile-sidebar'
import { SignOutButton } from '@/components/dashboard/sign-out-button'

const ROLE_LABEL_EN: Record<AppRole, string> = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  viewer: 'Viewer',
}

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const locale = getLocale()
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const appUser = await getAppUser()

  // Autenticado no Supabase Auth mas sem registro em public.users:
  // sem org/role resolvidos, o RLS não devolve nada — melhor avisar
  // do que renderizar um dashboard vazio.
  if (!appUser) {
    return (
      <div className="flex h-screen items-center justify-center" style={{ background: '#0a0f1e' }}>
        <div
          className="mx-4 max-w-md rounded-2xl p-8 text-center"
          style={{ background: '#141a2b', boxShadow: '0 1px 3px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.06)' }}
        >
          <h1 className="text-lg font-black text-white">
            {locale === 'en' ? 'Access not provisioned' : 'Acesso não provisionado'}
          </h1>
          <p className="mt-2 text-sm text-slate-400">
            {locale === 'en' ? (
              <>
                Your account <span className="font-semibold text-slate-200">{user.email}</span> was
                authenticated, but it is not linked to any company on the platform yet. Contact the
                Alizo team to get access.
              </>
            ) : (
              <>
                Sua conta <span className="font-semibold text-slate-200">{user.email}</span> foi autenticada,
                mas ainda não está vinculada a nenhuma empresa na plataforma. Fale com a equipe Alizo para
                liberar o acesso.
              </>
            )}
          </p>
          <div className="mt-6">
            <SignOutButton />
          </div>
        </div>
      </div>
    )
  }

  const email = appUser.email
  const initials = email.split('@')[0]?.slice(0, 2).toUpperCase() ?? 'AW'

  return (
    <div className="flex h-dvh overflow-hidden" style={{ background: '#0a0f1e' }}>
      {/* Sidebar fixa — só em desktop; em mobile vira drawer (MobileSidebar no header) */}
      <div className="hidden flex-shrink-0 lg:flex">
        <Sidebar userEmail={email} role={appUser.role} unitId={appUser.unitId} />
      </div>

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Glassmorphism header — dark */}
        <header
          className="sticky top-0 z-30 flex h-14 items-center justify-between px-4 sm:px-6"
          style={{
            background: 'rgba(10,15,30,0.9)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
            boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
          }}
        >
          <div className="flex items-center gap-2">
            <MobileSidebar userEmail={email} role={appUser.role} unitId={appUser.unitId} />
            <img src="/branding/alizo-icon.png" alt="Alizo" className="h-6 w-auto" />
            <p className="text-[14px] font-black tracking-tight text-white">alizo</p>
            <span style={{ color: 'rgba(255,255,255,0.2)' }}>/</span>
            <span className="rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider"
              style={{ background: 'rgba(6,182,212,0.15)', color: '#06b6d4' }}>
              OS
            </span>
          </div>

          <div className="flex items-center gap-3">
            {/* Live indicator — escondido em telas muito estreitas */}
            <div className="hidden items-center gap-1.5 sm:flex">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-50" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-cyan-400" />
              </span>
              <span className="text-[11px] font-semibold" style={{ color: 'rgba(148,163,184,0.7)' }}>
                {locale === 'en' ? 'Live' : 'Online'}
              </span>
            </div>

            {/* Divider */}
            <div className="hidden h-5 w-px sm:block" style={{ background: 'rgba(255,255,255,0.08)' }} />

            {/* Role badge (real, vindo de public.users) */}
            <span
              className="rounded-full px-2.5 py-1 text-[11px] font-black uppercase tracking-wider"
              style={{ background: 'rgba(6,182,212,0.12)', color: '#06b6d4' }}
              title={appUser.orgName ?? undefined}
            >
              {(locale === 'en' ? ROLE_LABEL_EN : ROLE_LABEL)[appUser.role]}
            </span>
            {!appUser.isSuperAdmin && appUser.orgName && (
              <span className="hidden max-w-[160px] truncate text-[11px] font-semibold text-slate-400 sm:inline">
                {appUser.orgName}
              </span>
            )}

            {/* Avatar */}
            <div
              className="flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-black text-white"
              style={{
                background: 'linear-gradient(135deg, #06b6d4, #4361ee)',
                boxShadow: '0 2px 8px rgba(6,182,212,0.3)',
              }}
            >
              {initials}
            </div>
          </div>
        </header>

        {/* Main — dark background */}
        <main
          className="flex-1 overflow-y-auto"
          style={{
            background: 'radial-gradient(ellipse 70% 40% at 50% -5%, rgba(67,97,238,0.08) 0%, transparent 60%), #0a0f1e',
          }}
        >
          <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">{children}</div>
        </main>
      </div>
    </div>
  )
}
