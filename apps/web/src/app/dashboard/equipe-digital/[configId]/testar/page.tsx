import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/dashboard-ui'
import { TestChat } from '@/components/dashboard/test-chat'
import { PreActivationTest } from '@/components/dashboard/pre-activation-test'
import { fetchOrganizationVerticalKey } from '@/lib/organizations'
import { VERTICAL_TEMPLATES } from '@/lib/verticals/catalog'
import type { AgentConfig, Unit } from '@/lib/types'

export const dynamic = 'force-dynamic'

const CHAT_TESTABLE_AGENT_TYPES = ['sdr', 'recruiter', 'receptionist'] as const
type ChatTestableAgentType = (typeof CHAT_TESTABLE_AGENT_TYPES)[number]

function isChatTestableAgentType(value: string): value is ChatTestableAgentType {
  return (CHAT_TESTABLE_AGENT_TYPES as readonly string[]).includes(value)
}

// Item 13 do pedido de prontidão pra beta: Tráfego/Conteúdo/SEO não
// conversam com cliente simulado, mas ainda precisam de uma validação
// pré-ativação ("não necessariamente baseada em chat") — ver
// PreActivationTest + /api/agent/pre-activation-test.
const PREVIEW_TESTABLE_AGENT_TYPES = ['content_specialist', 'seo_specialist', 'traffic_specialist'] as const
type PreviewTestableAgentType = (typeof PREVIEW_TESTABLE_AGENT_TYPES)[number]

function isPreviewTestableAgentType(value: string): value is PreviewTestableAgentType {
  return (PREVIEW_TESTABLE_AGENT_TYPES as readonly string[]).includes(value)
}

const ROLE_LABEL: Record<ChatTestableAgentType, string> = {
  sdr: 'AI Sales Representative',
  recruiter: 'recrutador(a)',
  receptionist: 'recepcionista/gerente de operações',
}

const PREVIEW_ROLE_LABEL: Record<PreviewTestableAgentType, string> = {
  content_specialist: 'gestor(a) de conteúdo',
  seo_specialist: 'especialista em SEO',
  traffic_specialist: 'gestor(a) de tráfego pago',
}

const PREVIEW_DESCRIPTION: Record<PreviewTestableAgentType, string> = {
  content_specialist: 'gera um post de verdade (legenda) com o prompt real, sem publicar nem salvar nada.',
  seo_specialist: 'roda uma auditoria de verdade no site configurado, sem salvar o resultado.',
  traffic_specialist: 'confere se existe alguma conta de anúncio de verdade conectada, sem criar nenhuma campanha.',
}

// Tela "Testar Funcionário" (sub-etapa 5/7): simula uma conversa com o
// funcionário digital usando o prompt real, sem tocar nada de produção,
// para Sales/Recruiter/Receptionist. Tráfego/Conteúdo/SEO usam
// PreActivationTest — não conversam com cliente simulado (Tráfego, por
// exemplo, só usa IA pro resumo executivo de métricas).
export default async function TestAgentPage({ params }: { params: { configId: string } }) {
  const supabase = await createClient()

  const { data: config } = await supabase
    .from('agent_configs')
    .select('*')
    .eq('id', params.configId)
    .maybeSingle()

  const configRow = config as AgentConfig | null
  if (!configRow || (!isChatTestableAgentType(configRow.agent_type) && !isPreviewTestableAgentType(configRow.agent_type))) {
    notFound()
  }

  const { data: unit } = await supabase
    .from('units')
    .select('*')
    .eq('id', configRow.unit_id)
    .maybeSingle()
  const unitRow = unit as Unit | null
  if (!unitRow) notFound()

  if (isPreviewTestableAgentType(configRow.agent_type)) {
    const agentType = configRow.agent_type
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
            {PREVIEW_ROLE_LABEL[agentType]} da unidade {unitRow.name} não conversa com cliente simulado — este teste{' '}
            {PREVIEW_DESCRIPTION[agentType]}
          </p>
        </div>

        <Card className="p-5">
          <PreActivationTest configId={configRow.id} unitId={configRow.unit_id} agentType={agentType} />
        </Card>
      </div>
    )
  }

  const chatAgentType = configRow.agent_type as ChatTestableAgentType
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
          Converse com {configRow.persona_name} ({ROLE_LABEL[chatAgentType]}
          {unitRow ? ` da unidade ${unitRow.name}` : ''}) como se fosse um cliente. Se alguma resposta
          não ficou boa, corrija ali mesmo — a correção passa a valer nas conversas reais.
        </p>
      </div>

      <Card className="p-5">
        <TestChat
          configId={configRow.id}
          unitId={configRow.unit_id}
          agentType={chatAgentType}
          personaName={configRow.persona_name}
          testScenarios={testScenarios}
        />
      </Card>
    </div>
  )
}
