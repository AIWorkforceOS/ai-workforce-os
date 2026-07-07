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
    <div className="flex h-screen overflow-hidden" style={{ background: '#f1f5f9' }}>
      <Sidebar userEmail={email} />

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Glassmorphism header */}
        <header
          className="sticky top-0 z-30 flex h-14 items-center justify-between px-6"
          style={{
            background: 'rgba(248,250,252,0.85)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            borderBottom: '1px solid rgba(226,232,240,0.7)',
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
          }}
        >
          <div className="flex items-center gap-2">
            <p className="text-[14px] font-black tracking-tight text-slate-800">AI Workforce</p>
            <span className="text-slate-300">/</span>
            <span className="rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider"
              style={{ background: 'rgba(34,197,94,0.1)', color: '#16a34a' }}>
              OS
            </span>
          </div>

          <div className="flex items-center gap-3">
            {/* Live indicator */}
            <div className="flex items-center gap-1.5">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-50" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
              </span>
              <span className="text-[11px] font-semibold text-slate-500">Online</span>
            </div>

            {/* Divider */}
            <div className="h-5 w-px bg-slate-200" />

            {/* Admin badge */}
            <span
              className="rounded-full px-2.5 py-1 text-[11px] font-black uppercase tracking-wider"
              style={{ background: 'rgba(34,197,94,0.1)', color: '#15803d' }}
            >
              Admin
            </span>

            {/* Avatar */}
            <div
              className="flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-black text-white"
              style={{
                background: 'linear-gradient(135deg, #22c55e, #15803d)',
                boxShadow: '0 2px 8px rgba(34,197,94,0.25)',
              }}
            >
              {initials}
            </div>
          </div>
        </header>

        {/* Main — subtle dot/gradient background */}
        <main
          className="flex-1 overflow-y-auto"
          style={{
            background: 'radial-gradient(ellipse 80% 40% at 60% -10%, rgba(34,197,94,0.04) 0%, transparent 60%), #f1f5f9',
          }}
        >
          <div className="mx-auto max-w-7xl px-6 py-6">{children}</div>
        </main>
      </div>
    </div>
  )
}
