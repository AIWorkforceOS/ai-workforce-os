import { getAppUser } from '@/lib/app-user'
import { AdminHome, ClientHome } from './home-views'

export const dynamic = 'force-dynamic'

// Home dividida por papel: super admin vê a operação inteira (AdminHome);
// admin de org vê a visão multi-unidade e dono de unidade (users.unit_id)
// vê a mesma home reenquadrada só pra unidade dele (ClientHome).
export default async function DashboardPage() {
  const appUser = await getAppUser()
  if (appUser?.isSuperAdmin) {
    return <AdminHome firstName={(appUser.name ?? appUser.email).split(/[\s@]/)[0] ?? 'time'} />
  }
  return (
    <ClientHome
      firstName={(appUser?.name ?? appUser?.email ?? 'você').split(/[\s@]/)[0] ?? 'você'}
      unitId={appUser?.unitId ?? null}
    />
  )
}
