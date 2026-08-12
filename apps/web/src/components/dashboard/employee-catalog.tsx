'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowRight,
  Bot,
  Briefcase,
  Camera,
  Check,
  ChevronRight,
  FlaskConical,
  GraduationCap,
  Headset,
  Loader2,
  Megaphone,
  Paperclip,
  Pause,
  Search,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Card, brandGradient } from '@/components/ui/dashboard-ui'
import { computeTrainingCompleteness } from '@/lib/interview/completeness'
import { buildClonedAgentConfig } from '@/lib/interview/clone'
import { pickDefaultUnit, unitHasWhatsapp, type UnitWhatsappChannelRow } from '@/lib/setup-status'
import type { VerticalKey } from '@/lib/verticals/catalog'
import type { AgentConfig, Unit } from '@/lib/types'

/** Unidade + config de origem elegíveis pra clonar treinamento (interview_status='completed'). */
type CloneSource = { unitId: string; unitName: string; config: AgentConfig }

// Catálogo dos funcionários digitais: a empresa vê os 3 disponíveis, ativa
// os que quiser e segue um passo a passo leigo por funcionário. "Ativar" =
// criar/ativar a linha de agent_configs da unidade (mesmo mecanismo que os
// crons de cada funcionário usam pra decidir quem trabalha).

type EmployeeState = 'working' | 'configuring' | 'available'

type Step = {
  label: string
  desc: string
  done: boolean
  /** link do passo (quando a ação acontece em outra tela) */
  href?: string
  /** passo resolvido aqui mesmo, com o formulário de ativação */
  inline?: boolean
}

const STATE_META: Record<EmployeeState, { label: string; style: React.CSSProperties }> = {
  working: { label: 'Trabalhando', style: { background: 'rgba(34,197,94,0.12)', color: '#4ade80' } },
  configuring: { label: 'Falta pouco', style: { background: 'rgba(245,158,11,0.12)', color: '#fbbf24' } },
  available: { label: 'Disponível pra ativar', style: { background: 'rgba(255,255,255,0.06)', color: '#94a3b8' } },
}

export function EmployeeCatalog({
  units,
  configs,
  whatsappChannels,
  openJobs,
  adAccounts,
  customers,
  socialAccounts,
  seoAudits,
  verticalKey,
}: {
  units: Unit[]
  configs: AgentConfig[]
  whatsappChannels: UnitWhatsappChannelRow[]
  openJobs: number
  adAccounts: number
  customers: number
  socialAccounts: number
  seoAudits: number
  verticalKey?: VerticalKey | null
}) {
  // A primeira unidade é a "principal" (mesma que /dashboard/onboarding
  // configura). Cada unidade tem sua própria linha em agent_configs
  // (unit_id) — o seletor abaixo decide qual delas este catálogo mostra,
  // já que organizações com mais de uma unidade (ex.: franquias) precisam
  // de perfis de negócio e treinamentos diferentes por unidade.
  const mainUnitId = units[0]?.id ?? null
  // Desempate determinístico (nunca "a primeira ativa que a query devolver" —
  // com duas unidades no mesmo created_at exato isso virou bug real em
  // produção, ver pickDefaultUnit): prioriza a unidade ativa com mais
  // progresso de configuração já feito.
  const [selectedUnitId, setSelectedUnitId] = useState(
    pickDefaultUnit(units, configs, whatsappChannels)?.id ?? mainUnitId ?? '',
  )
  const selectedUnit = units.find((u) => u.id === selectedUnitId) ?? null
  const isMainUnit = selectedUnitId === mainUnitId

  // O assistente guiado (/dashboard/onboarding) só existe pra unidade
  // principal; unidades adicionais configuram WhatsApp na tela de
  // unidade dedicada.
  const whatsappHref = isMainUnit ? '/dashboard/onboarding' : `/dashboard/units/${selectedUnitId}`

  const whatsappConnected = !!selectedUnit && unitHasWhatsapp(selectedUnit, whatsappChannels, 'sdr')
  const sdr = configs.find((c) => c.agent_type === 'sdr' && c.unit_id === selectedUnitId)
  const recruiter = configs.find((c) => c.agent_type === 'recruiter' && c.unit_id === selectedUnitId)
  const traffic = configs.find((c) => c.agent_type === 'traffic_specialist' && c.unit_id === selectedUnitId)
  const receptionist = configs.find((c) => c.agent_type === 'receptionist' && c.unit_id === selectedUnitId)
  const content = configs.find((c) => c.agent_type === 'content_specialist' && c.unit_id === selectedUnitId)
  const seo = configs.find((c) => c.agent_type === 'seo_specialist' && c.unit_id === selectedUnitId)

  // Unidades da MESMA org que já têm este funcionário treinado (ex.:
  // franquias que vendem o mesmo produto, só mudando a região) — permite
  // clonar o treinamento em vez de repetir a entrevista adaptativa do zero.
  function cloneSourcesFor(agentType: string): CloneSource[] {
    return units
      .filter((u) => u.id !== selectedUnitId)
      .flatMap((u) => {
        const config = configs.find((c) => c.agent_type === agentType && c.unit_id === u.id && c.interview_status === 'completed')
        return config ? [{ unitId: u.id, unitName: u.name, config }] : []
      })
  }

  // Mesmo padrão dos outros 3: "Contratar" é resolvido aqui mesmo (igual
  // recruiter/traffic/receptionist), não mais um passo que manda pra outra
  // tela — assim o botão "Contratar e entrevistar" aparece sempre, mesmo
  // em unidades que não são a principal do onboarding guiado.
  const sdrSteps: Step[] = [
    { label: 'Contratar o Sales Rep', desc: 'Escolha o nome dele e responda a entrevista de contratação — ele aprende sua empresa.', done: !!sdr?.is_active, inline: true },
    { label: 'Conectar o WhatsApp da empresa', desc: 'Escaneando um QR code, igual ao WhatsApp Web.', done: whatsappConnected, href: whatsappHref },
    { label: 'Testar uma conversa e ligar', desc: 'Você conversa com ele antes — e liga quando gostar.', done: !!sdr?.is_active, href: sdr ? `/dashboard/equipe-digital/${sdr.id}/testar` : undefined },
  ]

  const recruiterSteps: Step[] = [
    { label: 'Contratar o recrutador', desc: 'Escolha o nome dele e responda a entrevista de contratação — ele aprende sua empresa.', done: !!recruiter?.is_active, inline: true },
    { label: 'Conectar o WhatsApp da empresa', desc: 'Ele usa o mesmo WhatsApp do vendedor pra falar com candidatos.', done: whatsappConnected, href: whatsappHref },
    { label: 'Abrir sua primeira vaga', desc: 'Conte a vaga que precisa preencher; ele cuida do resto.', done: openJobs > 0, href: '/dashboard/recruiter/jobs/new' },
  ]

  const trafficSteps: Step[] = [
    { label: 'Contratar o gestor de tráfego', desc: 'Ele te entrevista sobre orçamento, público e objetivo — e fica de prontidão.', done: !!traffic?.is_active, inline: true },
    { label: 'Conectar suas contas de anúncio', desc: 'Você mesmo conecta pelo painel (Facebook/Instagram e Google) — testamos e confirmamos na hora.', done: adAccounts > 0, href: '/dashboard/traffic/connect' },
    { label: 'Acompanhar as recomendações', desc: 'Ele sugere melhorias todo dia — você aprova ou recusa cada uma.', done: adAccounts > 0, href: '/dashboard/traffic' },
  ]

  const receptionistSteps: Step[] = [
    { label: 'Contratar o AI Receptionist', desc: 'Escolha o nome dele e responda a entrevista de contratação — ele aprende como funciona seu atendimento.', done: !!receptionist?.is_active, inline: true },
    { label: 'Acompanhar o cadastro de clientes', desc: 'Todo negócio fechado pelo Sales Rep já entra automaticamente como cliente.', done: customers > 0, href: '/dashboard/receptionist/customers' },
  ]

  const contentSteps: Step[] = [
    { label: 'Contratar o Gestor de Conteúdo', desc: 'Ele te entrevista sobre os temas, o tom e a frequência de postagem — e fica de prontidão.', done: !!content?.is_active, inline: true },
    { label: 'Conectar Instagram e Facebook', desc: 'Você mesmo conecta pelo painel a Página do Facebook (e o Instagram vinculado a ela) — testamos e confirmamos na hora.', done: socialAccounts > 0, href: '/dashboard/content/connect' },
    { label: 'Acompanhar a fila de conteúdo', desc: 'Ele gera posts com legenda e imagem todo dia — você escolhe se ele posta sozinho ou se cada um passa por aprovação sua.', done: socialAccounts > 0, href: '/dashboard/content' },
  ]

  const seoSteps: Step[] = [
    { label: 'Contratar o especialista em SEO', desc: 'Ele te entrevista sobre o site, palavras-chave e concorrentes — e fica de prontidão.', done: !!seo?.is_active, inline: true },
    { label: 'Aguardar a primeira auditoria', desc: 'Ele audita o site de verdade (título, meta description, mobile, etc.) — pode rodar na hora pelo painel dele.', done: seoAudits > 0, href: '/dashboard/seo' },
  ]

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-500">equipe digital</p>
        <h1 className="mt-0.5 text-2xl font-black tracking-tight text-white">Seus funcionários digitais</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-400">
          Estes são os funcionários disponíveis hoje. Ative os que fazem sentido pro seu negócio —
          cada um tem um passo a passo curto, e você pode pausar quando quiser.
        </p>
      </div>

      {units.length > 1 && (
        <div className="rounded-2xl p-4" style={{ background: 'rgba(6,182,212,0.06)', border: '1px solid rgba(6,182,212,0.25)' }}>
          <p className="text-[10px] font-black uppercase tracking-widest text-cyan-400">
            Contratando e treinando para qual unidade?
          </p>
          <p className="mt-0.5 text-xs text-slate-400">
            Cada unidade tem seus próprios funcionários — nome, treinamento e ativação de uma não afetam a outra.
          </p>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            {units.map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => setSelectedUnitId(u.id)}
                className="rounded-full px-3 py-1.5 text-xs font-bold transition-colors"
                style={
                  u.id === selectedUnitId
                    ? { background: brandGradient, color: '#fff' }
                    : { border: '1px solid rgba(255,255,255,0.08)', color: '#94a3b8' }
                }
              >
                {u.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-4">
        <EmployeeCatalogCard
          icon={Bot}
          name="AI Sales Representative"
          tagline="Atende no WhatsApp e traz clientes"
          bullets={[
            'Responde quem chama no seu WhatsApp, dia e noite',
            'Descobre o que a pessoa precisa e identifica quem quer comprar',
            'Te entrega os interessados prontos pra você fechar',
          ]}
          steps={sdrSteps}
          state={sdr?.is_active && whatsappConnected ? 'working' : sdr || whatsappConnected ? 'configuring' : 'available'}
          panelHref="/dashboard/agents"
          personaName={sdr?.persona_name ?? null}
          activation={{ agentType: 'sdr', config: sdr ?? null, unitId: selectedUnitId, askName: true, defaultName: 'Kai', cloneSources: cloneSourcesFor('sdr'), regionHint: selectedUnit?.region_city ?? null }}
          trainingScore={sdr ? computeTrainingCompleteness(sdr, verticalKey) : null}
          testConfigId={sdr?.id ?? null}
          trainConfigId={sdr?.id ?? null}
          lastTrainedAt={sdr?.last_trained_at ?? null}
          resourcesHref={`/dashboard/equipe-digital/recursos?unit=${selectedUnitId}&employee=sdr`}
        />
        <EmployeeCatalogCard
          icon={Briefcase}
          name="Recrutador (RH)"
          tagline="Cuida das suas vagas e da triagem"
          bullets={[
            'Entende com você o perfil da pessoa que a vaga precisa',
            'Conversa com os candidatos e faz a triagem sozinho',
            'Te entrega uma lista curta só com os melhores',
          ]}
          steps={recruiterSteps}
          state={recruiter?.is_active ? (openJobs > 0 ? 'working' : 'configuring') : 'available'}
          panelHref="/dashboard/recruiter"
          personaName={recruiter?.persona_name ?? null}
          activation={{ agentType: 'recruiter', config: recruiter ?? null, unitId: selectedUnitId, askName: true, defaultName: 'Rafa', cloneSources: cloneSourcesFor('recruiter'), regionHint: selectedUnit?.region_city ?? null }}
          trainingScore={recruiter ? computeTrainingCompleteness(recruiter, verticalKey) : null}
          testConfigId={recruiter?.id ?? null}
          trainConfigId={recruiter?.id ?? null}
          lastTrainedAt={recruiter?.last_trained_at ?? null}
          resourcesHref={`/dashboard/equipe-digital/recursos?unit=${selectedUnitId}&employee=recruiter`}
        />
        <EmployeeCatalogCard
          icon={Megaphone}
          name="Gestor de tráfego"
          tagline="Cuida dos seus anúncios pagos"
          bullets={[
            'Acompanha suas campanhas do Instagram, Facebook e Google todos os dias',
            'Sugere onde investir mais e onde cortar desperdício',
            'Você aprova cada mudança antes de ela acontecer',
          ]}
          steps={trafficSteps}
          state={traffic?.is_active ? (adAccounts > 0 ? 'working' : 'configuring') : 'available'}
          panelHref="/dashboard/traffic"
          personaName={null}
          activation={{ agentType: 'traffic_specialist', config: traffic ?? null, unitId: selectedUnitId, askName: false, defaultName: 'Gestor de Tráfego', cloneSources: cloneSourcesFor('traffic_specialist'), regionHint: selectedUnit?.region_city ?? null }}
          trainingScore={traffic ? computeTrainingCompleteness(traffic, verticalKey) : null}
          trainConfigId={traffic?.id ?? null}
          lastTrainedAt={traffic?.last_trained_at ?? null}
          resourcesHref={`/dashboard/equipe-digital/recursos?unit=${selectedUnitId}&employee=traffic_specialist`}
        />
        <EmployeeCatalogCard
          icon={Headset}
          name="AI Receptionist"
          tagline="Organiza o atendimento e os clientes"
          bullets={[
            'Mantém o cadastro de clientes sempre atualizado',
            'Resolve sozinho(a) o que for rotina do dia a dia',
            'Avisa um humano no que exigir decisão, do jeito que a empresa ensinou',
          ]}
          steps={receptionistSteps}
          state={receptionist?.is_active ? (customers > 0 ? 'working' : 'configuring') : 'available'}
          panelHref="/dashboard/receptionist"
          personaName={receptionist?.persona_name ?? null}
          activation={{ agentType: 'receptionist', config: receptionist ?? null, unitId: selectedUnitId, askName: true, defaultName: 'Ana', cloneSources: cloneSourcesFor('receptionist'), regionHint: selectedUnit?.region_city ?? null }}
          trainingScore={receptionist ? computeTrainingCompleteness(receptionist, verticalKey) : null}
          testConfigId={receptionist?.id ?? null}
          trainConfigId={receptionist?.id ?? null}
          lastTrainedAt={receptionist?.last_trained_at ?? null}
          resourcesHref={`/dashboard/equipe-digital/recursos?unit=${selectedUnitId}&employee=receptionist`}
        />
        <EmployeeCatalogCard
          icon={Camera}
          name="Gestor de conteúdo"
          tagline="Cria e publica posts no Instagram e Facebook"
          bullets={[
            'Gera legenda e imagem de cada post com base no seu negócio de verdade',
            'Posta sozinho ou deixa pendente pra você aprovar — você escolhe',
            'Mantém o calendário de conteúdo sempre ativo, todo dia',
          ]}
          steps={contentSteps}
          state={content?.is_active ? (socialAccounts > 0 ? 'working' : 'configuring') : 'available'}
          panelHref="/dashboard/content"
          personaName={null}
          activation={{ agentType: 'content_specialist', config: content ?? null, unitId: selectedUnitId, askName: false, defaultName: 'Gestor de Conteúdo', cloneSources: cloneSourcesFor('content_specialist'), regionHint: selectedUnit?.region_city ?? null }}
          trainingScore={content ? computeTrainingCompleteness(content, verticalKey) : null}
          trainConfigId={content?.id ?? null}
          lastTrainedAt={content?.last_trained_at ?? null}
          resourcesHref={`/dashboard/equipe-digital/recursos?unit=${selectedUnitId}&employee=content_specialist`}
        />
        <EmployeeCatalogCard
          icon={Search}
          name="Especialista em SEO"
          tagline="Cuida do tráfego orgânico do seu site"
          bullets={[
            'Audita o site de verdade: título, meta description, mobile, HTTPS e mais',
            'Gera posts de blog/landing page e prepara seu Google Business Profile',
            'Não promete o topo do Google — isso depende de tempo, conteúdo e backlinks',
          ]}
          steps={seoSteps}
          state={seo?.is_active ? (seoAudits > 0 ? 'working' : 'configuring') : 'available'}
          panelHref="/dashboard/seo"
          personaName={null}
          activation={{ agentType: 'seo_specialist', config: seo ?? null, unitId: selectedUnitId, askName: false, defaultName: 'Especialista em SEO', cloneSources: cloneSourcesFor('seo_specialist'), regionHint: selectedUnit?.region_city ?? null }}
          trainingScore={seo ? computeTrainingCompleteness(seo, verticalKey) : null}
          trainConfigId={seo?.id ?? null}
          lastTrainedAt={seo?.last_trained_at ?? null}
          resourcesHref={`/dashboard/equipe-digital/recursos?unit=${selectedUnitId}&employee=seo_specialist`}
        />
      </div>

      <p className="text-xs text-slate-500">
        Contratou um plano que não inclui algum deles? Fale com a gente em{' '}
        <a href="mailto:suporte@alizo.com.br" className="text-slate-400 underline hover:text-cyan-400">suporte@alizo.com.br</a>{' '}
        que a equipe libera pra você.
      </p>
    </div>
  )
}

type ActivationProps = {
  agentType: 'sdr' | 'recruiter' | 'traffic_specialist' | 'receptionist' | 'content_specialist' | 'seo_specialist'
  /** config já filtrado pra unitId — nunca de outra unidade */
  config: AgentConfig | null
  /** unidade selecionada no catálogo (seletor no topo da tela) */
  unitId: string
  /** true = pede nome (funcionário que conversa com pessoas) */
  askName: boolean
  defaultName: string
  /** outras unidades da org que já têm este funcionário treinado — clonar em vez de entrevistar do zero */
  cloneSources?: CloneSource[]
  /** sugestão pra preencher o campo de região do clone (cidade da unidade de destino) */
  regionHint?: string | null
}

function formatTrainedDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function EmployeeCatalogCard({
  icon: Icon,
  name,
  tagline,
  bullets,
  steps,
  state,
  panelHref,
  personaName,
  activation,
  trainingScore,
  testConfigId,
  trainConfigId,
  lastTrainedAt,
  resourcesHref,
}: {
  icon: typeof Bot
  name: string
  tagline: string
  bullets: string[]
  steps: Step[]
  state: EmployeeState
  panelHref: string
  personaName: string | null
  activation?: ActivationProps
  /** null = funcionário ainda não foi contratado (sem agent_configs) */
  trainingScore?: number | null
  /** id do agent_config pra "Testar Funcionário" — ausente/null esconde o link (ex.: Tráfego, que não conversa com cliente simulado) */
  testConfigId?: string | null
  /** id do agent_config pra "Treinar Funcionário" (entrevista/retreinamento) — ausente/null esconde o link (funcionário ainda não contratado) */
  trainConfigId?: string | null
  /** quando business_profile foi atualizado pela última vez — null = nunca foi treinado (migration 029) */
  lastTrainedAt?: string | null
  /** link pra tela central de materiais (migration 062), já filtrado por unidade + este funcionário — independe de o funcionário já ter sido contratado, já que os materiais podem ser cadastrados com antecedência */
  resourcesHref: string
}) {
  const stateMeta = STATE_META[state]
  const nextStep = steps.find((s) => !s.done)

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl" style={{ background: brandGradient, boxShadow: '0 4px 12px rgba(6,182,212,0.25)' }}>
          <Icon size={18} className="text-white" />
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold" style={stateMeta.style}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'currentColor' }} />
            {stateMeta.label}
          </span>
          {trainingScore !== null && trainingScore !== undefined && (
            <span className="text-[10px] font-bold text-slate-500">Treinamento: {trainingScore}%</span>
          )}
        </div>
      </div>

      <div>
        <p className="text-base font-black text-white">
          {personaName ? `${personaName} · ${name}` : name}
        </p>
        <p className="text-xs font-semibold text-cyan-400">{tagline}</p>
        <ul className="mt-3 space-y-1.5">
          {bullets.map((b) => (
            <li key={b} className="flex items-start gap-2 text-xs leading-relaxed text-slate-400">
              <Check size={12} className="mt-0.5 flex-shrink-0 text-cyan-500" />
              {b}
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
        <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-slate-500">Como colocar pra trabalhar</p>
        <div className="space-y-2">
          {steps.map((step, i) => (
            <StepRow key={step.label} step={step} index={i} isNext={step === nextStep} activation={activation} />
          ))}
        </div>
      </div>

      <div className="mt-auto flex items-center gap-2">
        <Link
          href={panelHref}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-bold transition-all"
          style={
            state === 'working'
              ? { background: brandGradient, color: '#fff', boxShadow: '0 4px 12px rgba(6,182,212,0.25)' }
              : { border: '1px solid rgba(255,255,255,0.08)', color: '#e2e8f0' }
          }
        >
          {state === 'working' ? 'Ver o trabalho dele' : 'Ver o painel dele'}
          <ArrowRight size={11} />
        </Link>
        {activation?.config?.is_active && <PauseButton config={activation.config} />}
      </div>
      {trainConfigId && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <Link
              href={`/dashboard/equipe-digital/${trainConfigId}/entrevista`}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-[11px] font-bold transition-colors hover:brightness-110"
              style={{ border: '1px solid rgba(6,182,212,0.4)', color: '#22d3ee', background: 'rgba(6,182,212,0.1)' }}
            >
              <GraduationCap size={11} /> {lastTrainedAt ? 'Treinar de novo' : 'Treinar funcionário'}
            </Link>
            {testConfigId && (
              <Link
                href={`/dashboard/equipe-digital/${testConfigId}/testar`}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-[11px] font-bold text-slate-400 transition-colors hover:bg-white/5 hover:text-slate-200"
                style={{ border: '1px solid rgba(255,255,255,0.08)' }}
              >
                <FlaskConical size={11} /> Testar funcionário
              </Link>
            )}
          </div>
          <Link
            href={resourcesHref}
            className="flex items-center justify-center gap-1.5 rounded-xl py-2 text-[11px] font-bold text-slate-400 transition-colors hover:bg-white/5 hover:text-slate-200"
            style={{ border: '1px solid rgba(255,255,255,0.08)' }}
          >
            <Paperclip size={11} /> Materiais
          </Link>
          <p className="text-center text-[10px] font-semibold text-slate-500">
            {lastTrainedAt ? `Treinado em ${formatTrainedDate(lastTrainedAt)}` : 'Ainda não foi treinado'}
          </p>
        </div>
      )}
    </Card>
  )
}

function StepRow({
  step,
  index,
  isNext,
  activation,
}: {
  step: Step
  index: number
  isNext: boolean
  activation?: ActivationProps
}) {
  const number = (
    <div
      className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-black"
      style={step.done ? { background: 'rgba(34,197,94,0.2)', color: '#4ade80' } : isNext ? { background: brandGradient, color: '#fff' } : { background: 'rgba(255,255,255,0.06)', color: '#64748b' }}
    >
      {step.done ? <Check size={10} /> : index + 1}
    </div>
  )

  const body = (
    <div className="min-w-0 flex-1">
      <p className={`text-xs font-bold ${step.done ? 'text-slate-500 line-through decoration-slate-600' : 'text-slate-200'}`}>{step.label}</p>
      {!step.done && <p className="text-[11px] leading-snug text-slate-500">{step.desc}</p>}
    </div>
  )

  // Passo resolvido aqui mesmo (ativação): mostra o mini-formulário quando for a vez dele
  if (step.inline && !step.done && activation) {
    // Já entrevistado antes (ex.: reativar depois de pausar): reativação
    // rápida em 1 clique, sem repetir o wizard guiado.
    const canReactivateInline = activation.config?.interview_status === 'completed'
    return (
      <div className="flex items-start gap-2.5">
        {number}
        <div className="min-w-0 flex-1">
          {body}
          {isNext && canReactivateInline && <ActivateForm key={activation.unitId} {...activation} />}
          {isNext && !canReactivateInline && (
            activation.unitId ? (
              <Link
                href={`/dashboard/equipe-digital/contratar/${activation.agentType}?unit=${activation.unitId}`}
                className="mt-2 flex items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-xs font-black text-white"
                style={{ background: brandGradient, boxShadow: '0 4px 10px rgba(6,182,212,0.25)' }}
              >
                Contratar, passo a passo
                <ChevronRight size={11} />
              </Link>
            ) : (
              <Link href="/dashboard/units/new" className="mt-2 block text-[11px] font-semibold text-cyan-400 hover:underline">
                Crie uma unidade primeiro pra poder contratar
              </Link>
            )
          )}
          {isNext && !canReactivateInline && activation.unitId && !!activation.cloneSources?.length && (
            <CloneTrainingForm {...activation} unitId={activation.unitId} cloneSources={activation.cloneSources} />
          )}
        </div>
      </div>
    )
  }

  const row = (
    <div className="flex items-start gap-2.5">
      {number}
      {body}
      {!step.done && step.href && <ChevronRight size={12} className="mt-0.5 flex-shrink-0 text-slate-600" />}
    </div>
  )

  if (!step.done && step.href) {
    const external = step.href.startsWith('mailto:')
    return external ? (
      <a href={step.href} className="block rounded-lg transition-colors hover:bg-white/[0.04]">{row}</a>
    ) : (
      <Link href={step.href} className="block rounded-lg transition-colors hover:bg-white/[0.04]">{row}</Link>
    )
  }
  return row
}

function ActivateForm({ agentType, config, unitId, askName, defaultName }: ActivationProps) {
  const router = useRouter()
  const [name, setName] = useState(config?.persona_name ?? defaultName)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const interviewDone = config?.interview_status === 'completed'

  async function handleActivate() {
    if (askName && !name.trim()) {
      setError('Escolha um nome — é como ele vai se apresentar.')
      return
    }
    if (!unitId) {
      setError('Crie uma unidade primeiro (em Unidades) pra ativar este funcionário.')
      return
    }
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const payload = {
      unit_id: unitId,
      agent_type: agentType,
      persona_name: name.trim() || defaultName,
      persona_tone: config?.persona_tone ?? 'friendly',
      daily_limit: config?.daily_limit ?? 15,
      active_hours: config?.active_hours ?? { start: '08:00', end: '18:00', days: [1, 2, 3, 4, 5] },
      // Só liga direto quem já passou pela entrevista de contratação;
      // os demais são salvos inativos e seguem pra entrevista.
      is_active: interviewDone,
    }
    const { data, error: saveError } = config
      ? await supabase.from('agent_configs').update(payload).eq('id', config.id).select('id').single()
      : await supabase.from('agent_configs').insert(payload).select('id').single()
    setBusy(false)
    if (saveError || !data) {
      setError('Não deu pra ativar agora. Tente de novo — se persistir, fale com suporte@alizo.com.br.')
      return
    }
    if (interviewDone) {
      router.refresh()
      return
    }
    router.push(`/dashboard/equipe-digital/${data.id}/entrevista`)
  }

  return (
    <div className="mt-2 space-y-2">
      {askName && (
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nome dele (ex: Rafa, Bia...)"
          className="w-full rounded-lg px-3 py-2 text-xs text-white placeholder-slate-600 outline-none focus:border-cyan-500/50"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
        />
      )}
      {error && <p className="text-[11px] text-red-400">{error}</p>}
      <button
        onClick={handleActivate}
        disabled={busy}
        className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-black text-white disabled:opacity-60"
        style={{ background: brandGradient, boxShadow: '0 4px 10px rgba(6,182,212,0.25)' }}
      >
        {busy ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
        {busy ? 'Um instante...' : interviewDone ? 'Ativar agora' : 'Contratar e entrevistar'}
      </button>
      {!interviewDone && (
        <p className="text-[10px] leading-snug text-slate-500">
          Antes de trabalhar, ele faz uma entrevista rápida com você pra aprender tudo da sua empresa.
        </p>
      )}
    </div>
  )
}

/**
 * Alternativa a "Contratar, passo a passo": clona o treinamento já
 * concluído de outra unidade da mesma org (ex.: franquia que vende o
 * mesmo produto/serviço) trocando só a região de atuação — em vez de
 * repetir a entrevista adaptativa inteira do zero.
 */
function CloneTrainingForm({
  agentType,
  config,
  unitId,
  askName,
  defaultName,
  cloneSources,
  regionHint,
}: ActivationProps & { unitId: string; cloneSources: CloneSource[] }) {
  const router = useRouter()
  const [expanded, setExpanded] = useState(false)
  const [sourceUnitId, setSourceUnitId] = useState(cloneSources[0]?.unitId ?? '')
  const [region, setRegion] = useState(regionHint ?? '')
  const [name, setName] = useState(defaultName)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-[11px] font-bold text-slate-400 transition-colors hover:bg-white/5 hover:text-slate-200"
        style={{ border: '1px dashed rgba(255,255,255,0.15)' }}
      >
        ou clonar o treinamento de outra unidade
      </button>
    )
  }

  async function handleClone() {
    const source = cloneSources.find((s) => s.unitId === sourceUnitId)?.config
    if (!source) return
    if (!region.trim()) {
      setError('Informe a região de atuação desta unidade.')
      return
    }
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const cloned = buildClonedAgentConfig({ source, region })
    const payload = {
      unit_id: unitId,
      agent_type: agentType,
      persona_name: (askName ? name.trim() : defaultName) || defaultName,
      is_active: true,
      ...cloned,
    }
    const { error: saveError } = config
      ? await supabase.from('agent_configs').update(payload).eq('id', config.id)
      : await supabase.from('agent_configs').insert(payload)
    setBusy(false)
    if (saveError) {
      setError('Não deu pra clonar agora. Tente de novo — se persistir, fale com suporte@alizo.com.br.')
      return
    }
    router.refresh()
  }

  return (
    <div className="mt-2 space-y-2 rounded-lg p-2.5" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
      <p className="text-[10px] font-semibold text-slate-400">
        Copia o que {cloneSources.length === 1 ? 'a unidade abaixo' : 'a unidade escolhida'} já ensinou a este funcionário — só muda a região.
      </p>
      {cloneSources.length > 1 && (
        <select
          value={sourceUnitId}
          onChange={(e) => setSourceUnitId(e.target.value)}
          className="w-full rounded-lg px-3 py-2 text-xs text-white outline-none"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
        >
          {cloneSources.map((s) => (
            <option key={s.unitId} value={s.unitId} className="bg-slate-900">
              {s.unitName}
            </option>
          ))}
        </select>
      )}
      {askName && (
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nome dele (ex: Rafa, Bia...)"
          className="w-full rounded-lg px-3 py-2 text-xs text-white placeholder-slate-600 outline-none focus:border-cyan-500/50"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
        />
      )}
      <input
        value={region}
        onChange={(e) => setRegion(e.target.value)}
        placeholder="Região de atuação desta unidade (ex: Belo Horizonte)"
        className="w-full rounded-lg px-3 py-2 text-xs text-white placeholder-slate-600 outline-none focus:border-cyan-500/50"
        style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
      />
      {error && <p className="text-[11px] text-red-400">{error}</p>}
      <div className="flex items-center gap-2">
        <button
          onClick={handleClone}
          disabled={busy}
          className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-black text-white disabled:opacity-60"
          style={{ background: brandGradient, boxShadow: '0 4px 10px rgba(6,182,212,0.25)' }}
        >
          {busy ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
          {busy ? 'Clonando...' : 'Clonar treinamento'}
        </button>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="text-[11px] font-semibold text-slate-500 hover:text-slate-300"
        >
          Cancelar
        </button>
      </div>
    </div>
  )
}

function PauseButton({ config }: { config: AgentConfig }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function handlePause() {
    setBusy(true)
    const supabase = createClient()
    await supabase.from('agent_configs').update({ is_active: false }).eq('id', config.id)
    setBusy(false)
    router.refresh()
  }

  return (
    <button
      onClick={handlePause}
      disabled={busy}
      title="Pausar este funcionário"
      className="flex items-center gap-1 rounded-xl px-3 py-2.5 text-[11px] font-bold text-slate-400 transition-colors hover:bg-white/5 hover:text-slate-200 disabled:opacity-50"
      style={{ border: '1px solid rgba(255,255,255,0.08)' }}
    >
      {busy ? <Loader2 size={11} className="animate-spin" /> : <Pause size={11} />}
      Pausar
    </button>
  )
}
