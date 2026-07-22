import { createClient } from '@/lib/supabase/server'
import { getAppUser } from '@/lib/app-user'
import { fetchOrganizationManagementMode } from '@/lib/organizations'
import { AdminHome, ClientHome } from './home-views'
import { ManagementHome } from './management-home'

export const dynamic = 'force-dynamic'

// Home dividida por papel: super admin vê a operação inteira (AdminHome);
// admin de org vê a visão multi-unidade e dono de unidade (users.unit_id)
// vê a mesma home reenquadrada só pra unidade dele. Org que escolheu gestão
// completa na configuração guiada (management_mode = 'full_management')
// abre como sistema de gestão (ManagementHome); as demais mantêm a
// ClientHome de hoje.
export default async function DashboardPage() {
  const appUser = await getAppUser()
  if (appUser?.isSuperAdmin) {
    return <AdminHome firstName={(appUser.name ?? appUser.email).split(/[\s@]/)[0] ?? 'time'} />
  }

  const firstName = (appUser?.name ?? appUser?.email ?? 'você').split(/[\s@]/)[0] ?? 'você'
  const unitId = appUser?.unitId ?? null

  const supabase = await createClient()
  const managementMode = await fetchOrganizationManagementMode(supabase, appUser?.orgId)
  if (managementMode === 'full_management') {
    return <ManagementHome firstName={firstName} unitId={unitId} />
  }
  return <ClientHome firstName={firstName} unitId={unitId} />
}
