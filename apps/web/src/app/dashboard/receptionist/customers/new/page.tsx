import { createClient } from '@/lib/supabase/server'
import { getAppUser } from '@/lib/app-user'
import { fetchOrganizationVerticalKey } from '@/lib/organizations'
import { getCustomerTerm } from '@/lib/verticals/terminology'
import { NewCustomerForm } from '@/components/dashboard/new-customer-form'

export const dynamic = 'force-dynamic'

export default async function NewCustomerPage() {
  const supabase = await createClient()
  const appUser = await getAppUser()
  const verticalKey = await fetchOrganizationVerticalKey(supabase, appUser?.orgId)
  const term = getCustomerTerm(verticalKey, 'pt')
  const termPlural = getCustomerTerm(verticalKey, 'pt', { plural: true })

  return <NewCustomerForm customerTerm={term} customerTermPlural={termPlural} />
}
