'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { href: '/dashboard/sales', label: 'Visão geral', exact: true },
  { href: '/dashboard/sales/financeiro', label: 'Financeiro (DRE)', exact: false },
  { href: '/dashboard/sales/payments', label: 'Pagamentos', exact: false },
]

/** Navegação interna do painel Super Admin (área Vendas Alizo). */
export function SalesTabs() {
  const pathname = usePathname()

  return (
    <div
      className="flex w-fit items-center gap-1 rounded-xl p-1"
      style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}
    >
      {TABS.map(({ href, label, exact }) => {
        const active = exact ? pathname === href : pathname.startsWith(href)
        return (
          <Link
            key={href}
            href={href}
            className="rounded-lg px-3 py-1.5 text-xs font-bold transition-colors"
            style={
              active
                ? { background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)', color: '#fff' }
                : { color: '#94a3b8' }
            }
          >
            {label}
          </Link>
        )
      })}
    </div>
  )
}
