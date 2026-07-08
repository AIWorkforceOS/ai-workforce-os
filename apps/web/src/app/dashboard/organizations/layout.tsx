import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { getAppUser } from '@/lib/app-user'

// Gestão de empresas é exclusiva da equipe Alizo (super_admin).
export default async function OrganizationsLayout({ children }: { children: ReactNode }) {
  const appUser = await getAppUser()
  if (!appUser?.isSuperAdmin) {
    redirect('/dashboard')
  }
  return <>{children}</>
}
