import { redirect } from 'next/navigation'
import { getAppUser } from '@/lib/app-user'
import { createClient } from '@/lib/supabase/server'

/** Atalho do menu "Faturamento por cliente": leva para a unidade (dono de unidade e empresa com uma unidade vão direto; várias: a primeira ativa). */
export default async function BillingHubPage() {
  const appUser = await getAppUser()
  if (appUser?.unitId) redirect(`/dashboard/units/${appUser.unitId}/faturamento`)
  const supabase = await createClient()
  const { data } = await supabase.from('units').select('id').eq('is_active', true).order('name').limit(1)
  const first = (data as { id: string }[] | null)?.[0]
  redirect(first ? `/dashboard/units/${first.id}/faturamento` : '/dashboard/units')
}
