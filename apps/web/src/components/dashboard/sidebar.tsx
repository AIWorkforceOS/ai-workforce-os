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
  ChevronRight,
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
    <aside className="flex h-screen w-[220px] flex-shrink-0 flex-col bg-[#0c0c0c]">
      {/* Logo */}
      <div className="px-5 py-5">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-green-500">
            <Bot size={14} className="text-white" />
          </div>
          <div>
            <p className="text-sm font-semibold text-white leading-none">AI Workforce</p>
            <p className="text-[10px] text-green-400 leading-none mt-0.5">OS</p>
          </div>
        </div>
        <p className="mt-3 truncate text-[11px] text-zinc-500">{userEmail}</p>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 pb-4">
        {navGroups.map((group) => (
          <div key={group.label} className="mb-4">
            <p className="mb-1 px-2 text-[10px] font-medium uppercase tracking-widest text-zinc-600">
              {group.label}
            </p>
            {group.items.map(({ href, label, icon: Icon, exact }) => {
              const active = isActive(href, exact)
              return (
                <Link
                  key={href}
                  href={href}
                  className={`group flex items-center justify-between rounded-md px-2 py-2 text-[13px] transition-colors ${
                    active
                      ? 'bg-zinc-800 text-white'
                      : 'text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200'
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <Icon size={15} />
                    {label}
                  </span>
                  {active && <ChevronRight size={12} className="text-zinc-500" />}
                </Link>
              )
            })}
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="border-t border-zinc-800 px-3 py-3">
        <Link
          href="/dashboard/settings"
          className={`flex items-center gap-2.5 rounded-md px-2 py-2 text-[13px] transition-colors ${
            pathname.startsWith('/dashboard/settings')
              ? 'bg-zinc-800 text-white'
              : 'text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200'
          }`}
        >
          <Settings size={15} />
          Configurações
        </Link>
        <button
          onClick={handleSignOut}
          className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-[13px] text-zinc-600 transition-colors hover:bg-zinc-900 hover:text-zinc-300"
        >
          <LogOut size={15} />
          Sair
        </button>
      </div>
    </aside>
  )
}
