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
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      <Sidebar userEmail={email} />

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-slate-200 bg-white px-6 shadow-sm">
          <h1 className="text-[15px] font-bold text-slate-800">AI Workforce OS</h1>
          <div className="flex items-center gap-3">
            <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-bold text-green-700">
              Admin
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-[11px] font-black text-slate-600">
              {initials}
            </div>
          </div>
        </header>

        {/* Main */}
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-7xl px-6 py-6">{children}</div>
        </main>
      </div>
    </div>
  )
}
