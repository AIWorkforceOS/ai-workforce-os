import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { HireWizard } from '@/components/dashboard/hire-wizard'
import { isWizardAgentType } from '@/lib/employee-wizard-meta'
import type { AgentConfig, Unit } from '@/lib/types'

export const dynamic = 'force-dynamic'

// Wizard de contratação guiado — generaliza pros outros 5 funcionários
// digitais o padrão que hoje só existe pro Sales Rep em /dashboard/onboarding
// (ver components/dashboard/hire-wizard.tsx). unit=<id> vem do seletor de
// unidade do catálogo (components/dashboard/employee-catalog.tsx); sem ele,
// cai na primeira unidade da org.
export default async function HireWizardPage({
  params,
  searchParams,
}: {
  params: Promise<{ agentType: string }>
  searchParams: Promise<{ unit?: string }>
}) {
  const { agentType } = await params
  const { unit: unitIdParam } = await searchParams

  if (!isWizardAgentType(agentType)) notFound()

  const supabase = await createClient()

  const { data: units } = await supabase
    .from('units')
    .select('*')
    .order('created_at', { ascending: true })

  const unitRows = (units ?? []) as Unit[]
  const unit = (unitIdParam ? unitRows.find((u) => u.id === unitIdParam) : null) ?? unitRows[0] ?? null

  if (!unit) notFound()

  const { data: config } = await supabase
    .from('agent_configs')
    .select('*')
    .eq('unit_id', unit.id)
    .eq('agent_type', agentType)
    .maybeSingle()

  return (
    <HireWizard
      agentType={agentType}
      unit={unit}
      initialConfig={(config as AgentConfig | null) ?? null}
    />
  )
}
