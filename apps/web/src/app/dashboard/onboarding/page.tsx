import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getAppUser } from '@/lib/app-user'
import { computeSetupStatus, pickDefaultUnit, type UnitWhatsappChannelRow } from '@/lib/setup-status'
import { fetchOrganizationManagementMode } from '@/lib/organizations'
import { OnboardingWizard } from '@/components/onboarding/wizard'
import type { AgentConfig, Unit } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function OnboardingPage() {
  const supabase = await createClient()
  const appUser = await getAppUser()
  if (!appUser) redirect('/login')

  const [{ data: units }, { data: configs }, { data: whatsappChannels }, managementMode] = await Promise.all([
    supabase.from('units').select('*').order('created_at', { ascending: true }),
    supabase.from('agent_configs').select('*').eq('agent_type', 'sdr'),
    supabase.from('unit_whatsapp_channels').select('unit_id, agent_type, whatsapp_phone'),
    // raw: o wizard precisa distinguir "ainda não escolheu" (null) de escolha feita
    fetchOrganizationManagementMode(supabase, appUser.orgId, { raw: true }),
  ])

  const unitRows = (units ?? []) as Unit[]
  const configRows = (configs ?? []) as AgentConfig[]
  const channelRows = (whatsappChannels ?? []) as UnitWhatsappChannelRow[]
  const status = computeSetupStatus(unitRows, configRows, channelRows)

  // Unidade "principal" do onboarding — normalmente a primeira criada no
  // checkout, mas com desempate determinístico (nunca a ordem crua da
  // query) quando há mais de uma candidata, ver pickDefaultUnit.
  const unit = pickDefaultUnit(unitRows, configRows, channelRows)
  const config = unit ? (configRows.find((c) => c.unit_id === unit.id) ?? null) : null

  return (
    <OnboardingWizard
      unit={unit}
      config={config}
      initialSteps={status.steps}
      firstName={(appUser.name ?? appUser.email).split(/[\s@]/)[0] ?? 'você'}
      orgId={appUser.orgId}
      initialManagementMode={managementMode}
    />
  )
}
