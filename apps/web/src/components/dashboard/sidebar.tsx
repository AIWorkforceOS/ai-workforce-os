'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  LayoutDashboard,
  Building2,
  MapPin,
  Users,
  Bot,
  MessageSquare,
  UserCircle,
  Wallet,
  TrendingUp,
  Settings,
  LogOut,
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
      { href: '/dashboard/leads', label: 'Leads', icon: UserCircle },
      { href: '/dashboard/conversations', label: 'Conversas', icon: MessageSquare },
    ],
  },
  {
    label: 'Financeiro',
    items: [
      { href: '/dashboard/financial', label: 'Cobranças', icon: Wallet },
      { href: '/dashboard/results', label: 'Resultados', icon: TrendingUp },
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
    <aside className="flex h-screen w-64 flex-shrink-0 flex-col bg-[#0f172a] border-r border-white/5">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-green-500 shadow-lg shadow-green-500/20">
            <Bot size={18} className="text-white" />
          </div>
          <div>
            <p className="text-sm font-bold text-white leading-tight">AI Workforce</p>
            <p className="text-[11px] text-green-400 leading-tight font-medium">OS · Painel Admin</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {navGroups.map((group, gi) => (
          <div key={group.label}>
            {gi > 0 && <hr className="border-white/5 my-3" />}
            <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-widest text-slate-500">
              {group.label}
            </p>
            {group.items.map(({ href, label, icon: Icon, exact }) => {
              const active = isActive(href, exact)
              return (
                <Link
                  key={href}
                  href={href}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-all ${
                    active
                      ? 'bg-green-500/10 text-green-400 border-l-2 border-green-500 pl-[10px]'
                      : 'text-slate-400 hover:bg-white/5 hover:text-white border-l-2 border-transparent pl-[10px]'
                  }`}
                >
                  <Icon size={15} className={active ? 'text-green-400' : 'text-slate-500'} />
                  {label}
                </Link>
              )
            })}
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="border-t border-white/5 px-3 py-3 space-y-1">
        <Link
          href="/dashboard/settings"
          className={`flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-all border-l-2 ${
            pathname.startsWith('/dashboard/settings')
              ? 'bg-green-500/10 text-green-400 border-green-500'
              : 'text-slate-400 hover:bg-white/5 hover:text-white border-transparent'
          } pl-[10px]`}
        >
          <Settings size={15} />
          Configurações
        </Link>

        <div className="flex items-center gap-3 px-3 py-2 mt-2">
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-green-500 text-[11px] font-black text-white shadow-sm">
            {getInitials(userEmail)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-white truncate">{userEmail.split('@')[0]}</p>
            <p className="text-[11px] text-slate-500 truncate">{userEmail}</p>
          </div>
          <button
            onClick={handleSignOut}
            title="Sair"
            className="text-slate-500 hover:text-white transition-colors p-1"
          >
            <LogOut size={14} />
          </button>
        </div>
      </div>
    </aside>
  )
}
