import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Badge, Card, SectionLabel } from '@/components/ui/dashboard-ui'
import { InterviewChat } from '@/components/dashboard/interview-chat'
import { HANDOFF_RULES_LIST } from '@/lib/agent-identity'
import { AUTONOMY_SUMMARY } from '@/lib/interview/autonomy-summary'
import { INTERVIEW_PLAYBOOKS, isInterviewAgentType } from '@/lib/interview/engine'
import { computeTrainingCompleteness, missingProfileFields } from '@/lib/interview/completeness'
import { profileEntries } from '@/lib/interview/profile-format'
import { isVerticalKey } from '@/lib/verticals/catalog'
import type { AgentConfig, Organization, Unit } from '@/lib/types'

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

  const { data: organization } = unitRow?.org_id
    ? await supabase.from('organizations').select('vertical_key').eq('id', unitRow.org_id).maybeSingle()
    : { data: null }
  const organizationRow = organization as Pick<Organization, 'vertical_key'> | null
  const verticalKey = isVerticalKey(organizationRow?.vertical_key) ? organizationRow!.vertical_key : null

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

  // Manual de Trabalho (Fase 6): o que ele já aprendeu, o que ainda falta,
  // correções feitas testando ele e os limites universais que nenhum
  // funcionário digital pode ultrapassar — só aparece depois do primeiro
  // treino (perfil vazio antes disso não ajuda ninguém).
  const learnedEntries = profileEntries(configRow.business_profile)
  const missingFields = missingProfileFields(configRow, verticalKey)
  const completeness = computeTrainingCompleteness(configRow, verticalKey)
  const corrections = [...(configRow.training_corrections ?? [])].reverse()

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

      {learnedEntries.length > 0 && (
        <Card className="p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-black text-white">Manual de Trabalho</h2>
            <Badge variant={completeness >= 80 ? 'green' : completeness >= 40 ? 'amber' : 'red'}>
              {completeness}% do treinamento
            </Badge>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Tudo o que {configRow.persona_name} já aprendeu, o que ainda falta e o que ele nunca faz,
            em qualquer situação.
          </p>

          <div className="mt-4">
            <SectionLabel>O que ele já aprendeu</SectionLabel>
            <dl className="mt-2 grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {learnedEntries.map((entry) => (
                <div key={entry.label}>
                  <dt className="text-[11px] font-bold text-slate-500">{entry.label}</dt>
                  <dd className="text-sm text-slate-200">{entry.value}</dd>
                </div>
              ))}
            </dl>
          </div>

          {missingFields.length > 0 && (
            <div className="mt-5">
              <SectionLabel>Ainda falta ensinar</SectionLabel>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {missingFields.map((field) => (
                  <li key={field}>
                    <Badge variant="amber">{field}</Badge>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {corrections.length > 0 && (
            <div className="mt-5">
              <SectionLabel>Correções aprendidas testando ele</SectionLabel>
              <ul className="mt-2 space-y-2">
                {corrections.map((correction, i) => (
                  <li key={i} className="rounded-lg bg-white/5 p-3">
                    <p className="text-xs font-semibold text-slate-300">{correction.correction}</p>
                    <p className="mt-1 text-[11px] text-slate-500">{correction.context}</p>
                    <p className="mt-1 text-[10px] text-slate-600">
                      {new Date(correction.timestamp).toLocaleDateString('pt-BR', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                      })}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-5">
            <SectionLabel>O que ele decide sozinho hoje</SectionLabel>
            <p className="mt-2 text-xs text-slate-400">{AUTONOMY_SUMMARY[configRow.agent_type]}</p>
          </div>

          <div className="mt-5">
            <SectionLabel>Horário e escalonamento</SectionLabel>
            <p className="mt-2 text-xs text-slate-400">
              Atende {configRow.active_hours.days.length} dia(s) por semana, das {configRow.active_hours.start} às{' '}
              {configRow.active_hours.end}. Escala para um humano depois de {configRow.escalation_rules.after_messages}{' '}
              mensagens sem resolver
              {configRow.escalation_rules.keywords.length > 0
                ? `, ou se o cliente disser: ${configRow.escalation_rules.keywords.join(', ')}`
                : ''}
              .
            </p>
          </div>

          <div className="mt-5">
            <SectionLabel>O que ele nunca faz, em qualquer situação</SectionLabel>
            <ul className="mt-2 space-y-1.5 text-xs text-slate-400">
              {HANDOFF_RULES_LIST.map((rule, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-slate-600">•</span>
                  <span>{rule}</span>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      )}
    </div>
  )
}
