'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { LogOut } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useLocale } from '@/lib/i18n/client'
import type { ManagementMode } from '@/lib/types'
import { getVisibleNavGroups } from './nav-groups'

function getInitials(email: string): string {
  const parts = email.split('@')[0]?.split(/[._-]/) ?? []
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase()
  return (parts[0]?.slice(0, 2) ?? 'AW').toUpperCase()
}

export function Sidebar({
  userEmail,
  role = 'admin',
  unitId = null,
  managementMode = 'digital_employees',
  onNavigate,
}: {
  userEmail: string
  role?: string
  /** users.unit_id — preenchido = dono de unidade (só acessa a própria unidade) */
  unitId?: string | null
  /** organizations.management_mode efetivo — full_management libera Clientes/Agenda além do que todo modo já tem */
  managementMode?: ManagementMode
  /** chamado ao clicar num link — usado pelo drawer mobile pra fechar */
  onNavigate?: () => void
}) {
  const pathname = usePathname()
  const router = useRouter()
  const locale = useLocale()

  const visibleGroups = getVisibleNavGroups({ role, unitId, managementMode })

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
    <aside className="flex h-full w-64 flex-shrink-0 flex-col overflow-hidden" style={{ background: 'linear-gradient(180deg, #0a0f1e 0%, #0d1221 50%, #0a0f1e 100%)' }}>

      {/* Logo */}
      <div className="px-5 pt-5 pb-4">
        <img src="/branding/alizo-logo.png" alt="Alizo" className="h-8 w-auto" />
      </div>

      {/* Divider */}
      <div className="mx-4 mb-2 h-px" style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.06), transparent)' }} />

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-2 space-y-0.5">
        {visibleGroups.map((group, gi) => (
          <div key={group.label.pt} className={gi > 0 ? 'mt-4' : ''}>
            <p className="mb-1 px-2 text-[9px] font-black uppercase tracking-[0.15em]" style={{ color: 'rgba(148,163,184,0.4)' }}>
              {group.label[locale]}
            </p>
            {group.items.map(({ href, label, icon: Icon, exact }) => {
              const active = isActive(href, exact)
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={onNavigate}
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
                  <span className="flex-1">{label[locale]}</span>
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

      {/* Footer — Configurações agora mora só no grupo de nav (evita 2 links pra mesma tela) */}
      <div className="px-3 py-3 space-y-0.5">
        {/* User row */}
        <div className="flex items-center gap-2.5 rounded-xl px-2 py-2">
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
            title={locale === 'en' ? 'Sign out' : 'Sair'}
            className="rounded-lg p-1.5 text-slate-500 transition-all hover:bg-white/5 hover:text-slate-300"
          >
            <LogOut size={13} />
          </button>
        </div>
      </div>
    </aside>
  )
}
