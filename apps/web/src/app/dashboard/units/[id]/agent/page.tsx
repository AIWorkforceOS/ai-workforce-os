import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { AgentConfigForm } from '@/components/dashboard/agent-config-form'
import type { AgentConfig, Unit } from '@/lib/types'

export default async function UnitAgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const [{ data: unit }, { data: config }] = await Promise.all([
    supabase.from('units').select('*').eq('id', id).single(),
    supabase
      .from('agent_configs')
      .select('*')
      .eq('unit_id', id)
      .eq('agent_type', 'sdr')
      .maybeSingle(),
  ])

  if (!unit) {
    notFound()
  }

  const unitRow = unit as Unit

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Agente SDR — {unitRow.name}</h1>
        <p className="mt-1 text-sm text-slate-500">
          Configure a persona, tom, horários e setores de atuação do agente.
        </p>
      </div>

      <AgentConfigForm unitId={unitRow.id} initialConfig={config as AgentConfig | null} />
    </div>
  )
}
