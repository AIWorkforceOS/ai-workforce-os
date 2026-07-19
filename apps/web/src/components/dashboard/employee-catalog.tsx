'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowRight,
  Bot,
  Briefcase,
  Check,
  ChevronRight,
  Headset,
  Loader2,
  Megaphone,
  Pause,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Card, brandGradient } from '@/components/ui/dashboard-ui'
import { computeTrainingCompleteness } from '@/lib/interview/completeness'
import type { VerticalKey } from '@/lib/verticals/catalog'
import type { AgentConfig, Unit } from '@/lib/types'

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
  openJobs,
  adAccounts,
  customers,
  verticalKey,
}: {
  units: Unit[]
  configs: AgentConfig[]
  openJobs: number
  adAccounts: number
  customers: number
  verticalKey?: VerticalKey | null
}) {
  const whatsappConnected = units.some((u) => !!u.whatsapp_phone)
  const sdr = configs.find((c) => c.agent_type === 'sdr')
  const recruiter = configs.find((c) => c.agent_type === 'recruiter')
  const traffic = configs.find((c) => c.agent_type === 'traffic_specialist')
  const receptionist = configs.find((c) => c.agent_type === 'receptionist')

  const sdrSteps: Step[] = [
    { label: 'Conectar o WhatsApp da empresa', desc: 'Escaneando um QR code, igual ao WhatsApp Web.', done: whatsappConnected, href: '/dashboard/onboarding' },
    { label: 'Dar um nome e um jeito de falar', desc: 'É assim que ele vai se apresentar aos seus clientes.', done: !!sdr, href: '/dashboard/onboarding' },
    { label: 'Testar uma conversa e ligar', desc: 'Você conversa com ele antes — e liga quando gostar.', done: !!sdr?.is_active, href: '/dashboard/onboarding' },
  ]

  const recruiterSteps: Step[] = [
    { label: 'Contratar o recrutador', desc: 'Escolha o nome dele e responda a entrevista de contratação — ele aprende sua empresa.', done: !!recruiter?.is_active, inline: true },
    { label: 'Conectar o WhatsApp da empresa', desc: 'Ele usa o mesmo WhatsApp do vendedor pra falar com candidatos.', done: whatsappConnected, href: '/dashboard/onboarding' },
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
          trainingScore={sdr ? computeTrainingCompleteness(sdr, verticalKey) : null}
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
          activation={{ agentType: 'recruiter', config: recruiter ?? null, units, askName: true, defaultName: 'Rafa' }}
          trainingScore={recruiter ? computeTrainingCompleteness(recruiter, verticalKey) : null}
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
          activation={{ agentType: 'traffic_specialist', config: traffic ?? null, units, askName: false, defaultName: 'Gestor de Tráfego' }}
          trainingScore={traffic ? computeTrainingCompleteness(traffic, verticalKey) : null}
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
          activation={{ agentType: 'receptionist', config: receptionist ?? null, units, askName: true, defaultName: 'Ana' }}
          trainingScore={receptionist ? computeTrainingCompleteness(receptionist, verticalKey) : null}
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
  agentType: 'recruiter' | 'traffic_specialist' | 'receptionist'
  config: AgentConfig | null
  units: Unit[]
  /** true = pede nome (funcionário que conversa com pessoas) */
  askName: boolean
  defaultName: string
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
}: {
  icon: typeof Bot
  name: string
  tagline: string
  bullets: string[]
  steps: Step[]
  state: EmployeeState
  panelHref: string
  personaName: string | null
  /** ausente no SDR — a ativação dele acontece no passo a passo guiado */
  activation?: ActivationProps
  /** null = funcionário ainda não foi contratado (sem agent_configs) */
  trainingScore?: number | null
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
    return (
      <div className="flex items-start gap-2.5">
        {number}
        <div className="min-w-0 flex-1">
          {body}
          {isNext && <ActivateForm {...activation} />}
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

function ActivateForm({ agentType, config, units, askName, defaultName }: ActivationProps) {
  const router = useRouter()
  const activeUnits = units.filter((u) => u.is_active)
  const [name, setName] = useState(config?.persona_name ?? defaultName)
  const [unitId, setUnitId] = useState(activeUnits[0]?.id ?? units[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectableUnits = activeUnits.length > 0 ? activeUnits : units

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
      {selectableUnits.length > 1 && (
        <select
          value={unitId}
          onChange={(e) => setUnitId(e.target.value)}
          className="w-full rounded-lg px-3 py-2 text-xs text-white outline-none"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
        >
          {selectableUnits.map((u) => (
            <option key={u.id} value={u.id} style={{ background: '#141a2b' }}>{u.name}</option>
          ))}
        </select>
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
