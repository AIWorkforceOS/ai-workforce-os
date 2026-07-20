import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/dashboard-ui'
import { TestChat } from '@/components/dashboard/test-chat'
import { fetchOrganizationVerticalKey } from '@/lib/organizations'
import { VERTICAL_TEMPLATES } from '@/lib/verticals/catalog'
import type { AgentConfig, Unit } from '@/lib/types'

export const dynamic = 'force-dynamic'

const TESTABLE_AGENT_TYPES = ['sdr', 'recruiter', 'receptionist'] as const
type TestableAgentType = (typeof TESTABLE_AGENT_TYPES)[number]

function isTestableAgentType(value: string): value is TestableAgentType {
  return (TESTABLE_AGENT_TYPES as readonly string[]).includes(value)
}

const ROLE_LABEL: Record<TestableAgentType, string> = {
  sdr: 'AI Sales Representative',
  recruiter: 'recrutador(a)',
  receptionist: 'recepcionista/gerente de operações',
}

// Tela "Testar Funcionário" (sub-etapa 5/7): simula uma conversa com o
// funcionário digital usando o prompt real, sem tocar nada de produção.
// Cobre só Sales/Recruiter/Receptionist — Tráfego não conversa com cliente
// simulado (seu único uso de IA é o resumo executivo de métricas).
export default async function TestAgentPage({ params }: { params: { configId: string } }) {
  const supabase = await createClient()

  const { data: config } = await supabase
    .from('agent_configs')
    .select('*')
    .eq('id', params.configId)
    .maybeSingle()

  const configRow = config as AgentConfig | null
  if (!configRow || !isTestableAgentType(configRow.agent_type)) notFound()

  const { data: unit } = await supabase
    .from('units')
    .select('*')
    .eq('id', configRow.unit_id)
    .maybeSingle()
  const unitRow = unit as Unit | null
  if (!unitRow) notFound()

  const verticalKey = await fetchOrganizationVerticalKey(supabase, unitRow.org_id)
  const testScenarios = verticalKey ? (VERTICAL_TEMPLATES[verticalKey]?.testScenarios ?? []) : []

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <Link
          href="/dashboard/equipe-digital"
          className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-400 hover:text-slate-200"
        >
          <ArrowLeft size={12} /> Voltar pra equipe digital
        </Link>
        <h1 className="mt-2 text-2xl font-black tracking-tight text-white">
          Testar funcionário — {configRow.persona_name}
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-400">
          Converse com {configRow.persona_name} ({ROLE_LABEL[configRow.agent_type]}
          {unitRow ? ` da unidade ${unitRow.name}` : ''}) como se fosse um cliente. Se alguma resposta
          não ficou boa, corrija ali mesmo — a correção passa a valer nas conversas reais.
        </p>
      </div>

      <Card className="p-5">
        <TestChat
          configId={configRow.id}
          unitId={configRow.unit_id}
          agentType={configRow.agent_type}
          personaName={configRow.persona_name}
          testScenarios={testScenarios}
        />
      </Card>
    </div>
  )
}
