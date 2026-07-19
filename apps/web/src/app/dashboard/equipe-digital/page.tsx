import { createClient } from '@/lib/supabase/server'
import { getAppUser } from '@/lib/app-user'
import { fetchOrganizationVerticalKey } from '@/lib/organizations'
import { EmployeeCatalog } from '@/components/dashboard/employee-catalog'
import type { AgentConfig, Unit } from '@/lib/types'

export const dynamic = 'force-dynamic'

// Catálogo dos funcionários digitais: a tela onde a empresa vê os 3
// funcionários disponíveis, ativa os que contratou e segue o passo a
// passo de configuração de cada um.
export default async function DigitalTeamPage() {
  const supabase = await createClient()
  const appUser = await getAppUser()

  const [{ data: units }, { data: configs }, { count: openJobs }, { count: adAccounts }, { count: customers }, verticalKey] =
    await Promise.all([
      supabase.from('units').select('*').order('created_at', { ascending: true }),
      supabase.from('agent_configs').select('*'),
      supabase.from('job_openings').select('id', { count: 'exact', head: true }),
      supabase.from('ad_accounts').select('id', { count: 'exact', head: true }),
      supabase.from('customers').select('id', { count: 'exact', head: true }),
      fetchOrganizationVerticalKey(supabase, appUser?.orgId),
    ])

  return (
    <EmployeeCatalog
      units={(units ?? []) as Unit[]}
      configs={(configs ?? []) as AgentConfig[]}
      openJobs={openJobs ?? 0}
      adAccounts={adAccounts ?? 0}
      customers={customers ?? 0}
      verticalKey={verticalKey}
    />
  )
}
