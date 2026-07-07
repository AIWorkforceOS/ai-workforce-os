import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Sidebar } from '@/components/dashboard/sidebar'

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const email = user.email ?? ''
  const initials = email.split('@')[0]?.slice(0, 2).toUpperCase() ?? 'AW'

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: '#0a0f1e' }}>
      <Sidebar userEmail={email} />

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Glassmorphism header — dark */}
        <header
          className="sticky top-0 z-30 flex h-14 items-center justify-between px-6"
          style={{
            background: 'rgba(10,15,30,0.9)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
            boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
          }}
        >
          <div className="flex items-center gap-2">
            <p className="text-[14px] font-black tracking-tight text-white">alizo</p>
            <span style={{ color: 'rgba(255,255,255,0.2)' }}>/</span>
            <span className="rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider"
              style={{ background: 'rgba(6,182,212,0.15)', color: '#06b6d4' }}>
              OS
            </span>
          </div>

          <div className="flex items-center gap-3">
            {/* Live indicator */}
            <div className="flex items-center gap-1.5">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-50" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-cyan-400" />
              </span>
              <span className="text-[11px] font-semibold" style={{ color: 'rgba(148,163,184,0.7)' }}>Online</span>
            </div>

            {/* Divider */}
            <div className="h-5 w-px" style={{ background: 'rgba(255,255,255,0.08)' }} />

            {/* Admin badge */}
            <span
              className="rounded-full px-2.5 py-1 text-[11px] font-black uppercase tracking-wider"
              style={{ background: 'rgba(6,182,212,0.12)', color: '#06b6d4' }}
            >
              Admin
            </span>

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
          <div className="mx-auto max-w-7xl px-6 py-6">{children}</div>
        </main>
      </div>
    </div>
  )
}
