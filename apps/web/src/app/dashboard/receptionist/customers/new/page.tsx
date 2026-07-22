import { createClient } from '@/lib/supabase/server'
import { getAppUser } from '@/lib/app-user'
import { fetchOrganizationManagementMode, fetchOrganizationVerticalKey } from '@/lib/organizations'
import { getCustomerTerm } from '@/lib/verticals/terminology'
import { VERTICAL_TEMPLATES } from '@/lib/verticals/catalog'
import { NewCustomerForm } from '@/components/dashboard/new-customer-form'

export const dynamic = 'force-dynamic'

export default async function NewCustomerPage() {
  const supabase = await createClient()
  const appUser = await getAppUser()
  const [verticalKey, managementMode] = await Promise.all([
    fetchOrganizationVerticalKey(supabase, appUser?.orgId),
    fetchOrganizationManagementMode(supabase, appUser?.orgId),
  ])
  const term = getCustomerTerm(verticalKey, 'pt')
  const termPlural = getCustomerTerm(verticalKey, 'pt', { plural: true })
  const customFieldSchema = verticalKey ? VERTICAL_TEMPLATES[verticalKey].customerFieldSchema : []

  return (
    <NewCustomerForm
      customerTerm={term}
      customerTermPlural={termPlural}
      customFieldSchema={customFieldSchema}
      showServiceFields={managementMode === 'full_management'}
    />
  )
}
