import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { AgentConfigForm } from '@/components/dashboard/agent-config-form'
import type { AgentConfig, Unit } from '@/lib/types'

export default async function UnitAgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const [{ data: unit }, { data: sdrConfig }, { data: recruiterConfig }] = await Promise.all([
    supabase.from('units').select('*').eq('id', id).single(),
    supabase
      .from('agent_configs')
      .select('*')
      .eq('unit_id', id)
      .eq('agent_type', 'sdr')
      .maybeSingle(),
    supabase
      .from('agent_configs')
      .select('*')
      .eq('unit_id', id)
      .eq('agent_type', 'recruiter')
      .maybeSingle(),
  ])

  if (!unit) {
    notFound()
  }

  const unitRow = unit as Unit

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-xl font-black tracking-tight text-white">Agente SDR — {unitRow.name}</h1>
          <p className="mt-1 text-sm text-slate-400">
            Configure a persona, tom, horários e setores de atuação do agente de pré-vendas.
          </p>
        </div>
        <AgentConfigForm unitId={unitRow.id} initialConfig={sdrConfig as AgentConfig | null} agentType="sdr" />
      </div>

      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-xl font-black tracking-tight text-white">Recrutador IA — {unitRow.name}</h1>
          <p className="mt-1 text-sm text-slate-400">
            Funcionário digital de R&S: levanta o perfil da vaga com a empresa, busca e tria candidatos e
            entrega a shortlist. Usa o mesmo WhatsApp da unidade, com limite diário compartilhado com o SDR.
          </p>
        </div>
        <AgentConfigForm unitId={unitRow.id} initialConfig={recruiterConfig as AgentConfig | null} agentType="recruiter" />
      </div>
    </div>
  )
}
