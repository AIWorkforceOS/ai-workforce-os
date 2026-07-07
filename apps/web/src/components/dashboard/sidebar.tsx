'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  LayoutDashboard,
  Building2,
  MapPin,
  Users,
  MessageSquare,
  UserCircle,
  Wallet,
  TrendingUp,
  Settings,
  LogOut,
  ShoppingCart,
  Rocket,
  Kanban,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

const navGroups = [
  {
    label: 'Principal',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, exact: true },
      { href: '/dashboard/organizations', label: 'Empresas', icon: Building2 },
      { href: '/dashboard/units', label: 'Unidades', icon: MapPin },
      { href: '/dashboard/employees', label: 'Funcionários', icon: Users },
    ],
  },
  {
    label: 'Operações',
    items: [
      { href: '/dashboard/agents', label: 'Agentes IA', icon: Bot },
      { href: '/dashboard/crm', label: 'CRM Pipeline', icon: Kanban },
      { href: '/dashboard/leads', label: 'Leads (lista)', icon: UserCircle },
      { href: '/dashboard/conversations', label: 'Conversas', icon: MessageSquare },
    ],
  },
  {
    label: 'Financeiro',
    items: [
      { href: '/dashboard/financial', label: 'Cobranças', icon: Wallet },
      { href: '/dashboard/results', label: 'Resultados', icon: TrendingUp },
      { href: '/dashboard/sales', label: 'Vendas', icon: ShoppingCart },
    ],
  },
  {
    label: 'Setup',
    items: [
      { href: '/dashboard/onboarding', label: 'Onboarding', icon: Rocket },
    ],
  },
]

function getInitials(email: string): string {
  const parts = email.split('@')[0]?.split(/[._-]/) ?? []
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase()
  return (parts[0]?.slice(0, 2) ?? 'AW').toUpperCase()
}

export function Sidebar({ userEmail }: { userEmail: string }) {
  const pathname = usePathname()
  const router = useRouter()

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  function isActive(href: string, exact?: boolean) {
    return exact ? pathname === href : pathname.startsWith(href)
  }

  return (
    <aside className="flex h-screen w-64 flex-shrink-0 flex-col overflow-hidden" style={{ background: 'linear-gradient(180deg, #0a0f1e 0%, #0d1221 50%, #0a0f1e 100%)' }}>

      {/* Logo */}
      <div className="px-5 pt-5 pb-4">
        <div className="flex items-center gap-3">
          {/* Alizo icon */}
          <div className="relative flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)', boxShadow: '0 0 20px rgba(6,182,212,0.4), 0 4px 12px rgba(0,0,0,0.3)' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M5 12C5 9.239 7.239 7 10 7C12.761 7 15 9.239 15 12C15 14.761 12.761 17 10 17C8.5 17 7.15 16.35 6.2 15.3" stroke="white" strokeWidth="2.2" strokeLinecap="round" fill="none"/>
              <path d="M19 12C19 14.761 16.761 17 14 17C11.239 17 9 14.761 9 12C9 9.239 11.239 7 14 7C15.5 7 16.85 7.65 17.8 8.7" stroke="white" strokeWidth="2.2" strokeLinecap="round" fill="none"/>
            </svg>
            {/* Pulse ring */}
            <span className="absolute -right-0.5 -top-0.5 flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-40" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-cyan-400" />
            </span>
          </div>
          <div>
            <p className="text-sm font-black text-white leading-none tracking-tight">alizo</p>
            <p className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.12em]" style={{ color: 'rgba(103,232,249,0.8)' }}>AI Workforce OS</p>
          </div>
        </div>
      </div>

      {/* Divider */}
      <div className="mx-4 mb-2 h-px" style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.06), transparent)' }} />

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-2 space-y-0.5">
        {navGroups.map((group, gi) => (
          <div key={group.label} className={gi > 0 ? 'mt-4' : ''}>
            <p className="mb-1 px-2 text-[9px] font-black uppercase tracking-[0.15em]" style={{ color: 'rgba(148,163,184,0.4)' }}>
              {group.label}
            </p>
            {group.items.map(({ href, label, icon: Icon, exact }) => {
              const active = isActive(href, exact)
              return (
                <Link
                  key={href}
                  href={href}
                  className={`group flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] font-medium transition-all duration-150 ${
                    active
                      ? 'text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                  style={active ? {
                    background: 'linear-gradient(135deg, rgba(6,182,212,0.18) 0%, rgba(67,97,238,0.1) 100%)',
                    boxShadow: 'inset 0 0 0 1px rgba(6,182,212,0.2)',
                  } : undefined}
                >
                  <div className={`flex h-6 w-6 items-center justify-center rounded-lg transition-all ${
                    active ? '' : 'group-hover:bg-white/5'
                  }`} style={active ? { background: 'rgba(6,182,212,0.2)' } : undefined}>
                    <Icon size={13} className={active ? 'text-cyan-400' : 'text-slate-500 group-hover:text-slate-300'} />
                  </div>
                  <span className="flex-1">{label}</span>
                  {active && (
                    <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" style={{ boxShadow: '0 0 6px rgba(6,182,212,0.7)' }} />
                  )}
                </Link>
              )
            })}
          </div>
        ))}
      </nav>

      {/* Bottom divider */}
      <div className="mx-4 h-px" style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.06), transparent)' }} />

      {/* Footer */}
      <div className="px-3 py-3 space-y-0.5">
        <Link
          href="/dashboard/settings"
          className={`group flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] font-medium transition-all ${
            pathname.startsWith('/dashboard/settings')
              ? 'text-white'
              : 'text-slate-400 hover:text-slate-200'
          }`}
          style={pathname.startsWith('/dashboard/settings') ? {
            background: 'linear-gradient(135deg, rgba(6,182,212,0.18) 0%, rgba(67,97,238,0.1) 100%)',
            boxShadow: 'inset 0 0 0 1px rgba(6,182,212,0.2)',
          } : undefined}
        >
          <div className={`flex h-6 w-6 items-center justify-center rounded-lg ${pathname.startsWith('/dashboard/settings') ? '' : 'group-hover:bg-white/5'}`}
            style={pathname.startsWith('/dashboard/settings') ? { background: 'rgba(6,182,212,0.2)' } : undefined}>
            <Settings size={13} className={pathname.startsWith('/dashboard/settings') ? 'text-cyan-400' : 'text-slate-500 group-hover:text-slate-300'} />
          </div>
          Configurações
        </Link>

        {/* User row */}
        <div className="mt-2 flex items-center gap-2.5 rounded-xl px-2 py-2">
          <div className="relative flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-black text-white"
            style={{ background: 'linear-gradient(135deg, #06b6d4, #4361ee)', boxShadow: '0 2px 8px rgba(6,182,212,0.3)' }}>
            {getInitials(userEmail)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-white truncate">{userEmail.split('@')[0]}</p>
            <p className="text-[10px] truncate" style={{ color: 'rgba(148,163,184,0.5)' }}>{userEmail}</p>
          </div>
          <button
            onClick={handleSignOut}
            title="Sair"
            className="rounded-lg p-1.5 text-slate-500 transition-all hover:bg-white/5 hover:text-slate-300"
          >
            <LogOut size={13} />
          </button>
        </div>
      </div>
    </aside>
  )
}
