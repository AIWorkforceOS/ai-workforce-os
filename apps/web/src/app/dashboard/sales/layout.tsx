import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { getAppUser } from '@/lib/app-user'
import { SalesTabs } from '@/components/admin/sales-tabs'

// Painel de vendas da plataforma é exclusivo da equipe Alizo (super_admin).
export default async function SalesLayout({ children }: { children: ReactNode }) {
  const appUser = await getAppUser()
  if (!appUser?.isSuperAdmin) {
    redirect('/dashboard')
  }
  return (
    <div className="flex flex-col gap-4">
      <SalesTabs />
      {children}
    </div>
  )
}
