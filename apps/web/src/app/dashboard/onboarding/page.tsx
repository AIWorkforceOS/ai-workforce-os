import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getAppUser } from '@/lib/app-user'
import { computeSetupStatus } from '@/lib/setup-status'
import { OnboardingWizard } from '@/components/onboarding/wizard'
import type { AgentConfig, Unit } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function OnboardingPage() {
  const supabase = await createClient()
  const appUser = await getAppUser()
  if (!appUser) redirect('/login')

  const [{ data: units }, { data: configs }] = await Promise.all([
    supabase.from('units').select('*').order('created_at', { ascending: true }),
    supabase.from('agent_configs').select('*').eq('agent_type', 'sdr'),
  ])

  const unitRows = (units ?? []) as Unit[]
  const configRows = (configs ?? []) as AgentConfig[]
  const status = computeSetupStatus(unitRows, configRows)

  // A primeira unidade é a "principal" do onboarding (criada no checkout).
  const unit = unitRows[0] ?? null
  const config = unit ? (configRows.find((c) => c.unit_id === unit.id) ?? null) : null

  return (
    <OnboardingWizard
      unit={unit}
      config={config}
      initialSteps={status.steps}
      firstName={(appUser.name ?? appUser.email).split(/[\s@]/)[0] ?? 'você'}
    />
  )
}
