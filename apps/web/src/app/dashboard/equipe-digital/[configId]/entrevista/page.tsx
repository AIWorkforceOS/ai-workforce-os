import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/dashboard-ui'
import { InterviewChat } from '@/components/dashboard/interview-chat'
import { INTERVIEW_PLAYBOOKS, isInterviewAgentType } from '@/lib/interview/engine'
import type { AgentConfig, Unit } from '@/lib/types'

export const dynamic = 'force-dynamic'

// Entrevista de contratação do funcionário digital: antes de começar a
// trabalhar, ele conversa com o dono/gestor pra aprender 100% da empresa.
// Ao concluir (o próprio funcionário decide, sempre depois da pergunta
// final "tem mais alguma coisa?"), ele é ativado automaticamente.
//
// Esta mesma tela também é o "Treinar de novo" (migration 029): se a
// entrevista inicial já foi concluída, ela automaticamente entra em modo
// de retreinamento — refaz a conversa e atualiza o perfil existente sem
// desativar o funcionário nem duplicar nada.
export default async function InterviewPage({ params }: { params: { configId: string } }) {
  const supabase = await createClient()

  const { data: config } = await supabase
    .from('agent_configs')
    .select('*')
    .eq('id', params.configId)
    .maybeSingle()

  const configRow = config as AgentConfig | null
  if (!configRow || !isInterviewAgentType(configRow.agent_type)) notFound()

  const { data: unit } = await supabase
    .from('units')
    .select('*')
    .eq('id', configRow.unit_id)
    .maybeSingle()
  const unitRow = unit as Unit | null

  const playbook = INTERVIEW_PLAYBOOKS[configRow.agent_type]
  const isRetrain = configRow.interview_status === 'completed'
  const lastTrainedLabel = configRow.last_trained_at
    ? new Date(configRow.last_trained_at).toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null

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
          {isRetrain ? 'Treinar de novo' : 'Entrevista de contratação'} — {configRow.persona_name}
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-400">
          {isRetrain ? (
            <>
              {configRow.persona_name} continua trabalhando normalmente enquanto vocês conversam.
              Conte o que mudou ou o que ele deveria saber — as respostas atualizam a ficha que ele já
              tem, sem apagar o que já foi ensinado antes.
            </>
          ) : (
            <>
              {configRow.persona_name} é seu novo {playbook.roleLabel} digital
              {unitRow ? ` da unidade ${unitRow.name}` : ''}. Antes de começar a trabalhar, ele precisa
              conhecer sua empresa: responda às perguntas dele como você responderia a um funcionário
              novo. Quando ele tiver aprendido tudo, ele mesmo avisa que está pronto — e já começa a
              trabalhar.
            </>
          )}
        </p>
        <p className="mt-1 text-xs font-semibold text-slate-500">
          {lastTrainedLabel ? `Último treino: ${lastTrainedLabel}` : 'Ainda não foi treinado'}
        </p>
      </div>

      <Card className="p-5">
        <InterviewChat
          configId={configRow.id}
          personaName={configRow.persona_name}
          height="h-[520px]"
          retrain={isRetrain}
        />
      </Card>

      <p className="text-xs text-slate-500">
        Pode sair e voltar quando quiser — {isRetrain ? 'o retreinamento' : 'a entrevista'} continua de
        onde parou.
      </p>
    </div>
  )
}
