'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeft, Check, ChevronRight, ExternalLink, Loader2, PartyPopper, Play,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Card, brandGradient } from '@/components/ui/dashboard-ui'
import { InterviewChat } from '@/components/dashboard/interview-chat'
import { TestChat } from '@/components/dashboard/test-chat'
import { WhatsAppConnectStep } from '@/components/dashboard/whatsapp-connect-step'
import { SeoAuditRunButton } from '@/components/dashboard/seo-audit-run-button'
import { EMPLOYEE_WIZARD_META, type WizardAgentType } from '@/lib/employee-wizard-meta'
import type { AgentConfig, AgentTone, Unit } from '@/lib/types'

// Wizard de contratação genérico — estende pros outros 5 funcionários
// digitais o mesmo padrão passo-a-passo validado no wizard do Sales Rep
// (components/onboarding/wizard.tsx), reaproveitando as mesmas peças já
// testadas: InterviewChat (entrevista adaptativa + trigger de banco que
// bloqueia ativação sem entrevista concluída), WhatsAppConnectStep e TestChat.

type StepId = 'about' | 'interview' | 'connect' | 'test' | 'done'

const TONES: { id: AgentTone; label: string; emoji: string; desc: string }[] = [
  { id: 'friendly', label: 'Amigável', emoji: '😊', desc: 'caloroso e próximo' },
  { id: 'professional', label: 'Profissional', emoji: '💼', desc: 'direto ao ponto' },
  { id: 'formal', label: 'Formal', emoji: '🎩', desc: 'cortês e respeitoso' },
]

export function HireWizard({
  agentType,
  unit,
  initialConfig,
}: {
  agentType: WizardAgentType
  unit: Unit
  initialConfig: AgentConfig | null
}) {
  const meta = EMPLOYEE_WIZARD_META[agentType]

  const [config, setConfig] = useState<AgentConfig | null>(initialConfig)

  const stepOrder = useMemo<StepId[]>(() => {
    const order: StepId[] = ['about', 'interview', 'connect']
    if (meta.testable) order.push('test')
    order.push('done')
    return order
  }, [meta.testable])

  const [step, setStep] = useState<StepId>(() => {
    if (!initialConfig) return 'about'
    if (initialConfig.interview_status !== 'completed') return 'interview'
    return 'connect'
  })

  const stepIndex = stepOrder.indexOf(step)

  function goTo(target: StepId) {
    setStep(target)
  }

  function advance() {
    const next = stepOrder[stepIndex + 1]
    if (next) setStep(next)
  }

  const STEP_LABEL: Record<StepId, string> = {
    about: 'Sobre',
    interview: 'Entrevista',
    connect: meta.connectStep.type === 'whatsapp' ? 'WhatsApp' : meta.connectStep.type === 'seo-audit' ? 'Auditoria' : 'Conectar',
    test: 'Testar',
    done: 'Pronto',
  }

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
          Contratar {meta.name}
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          Passo a passo guiado — igual ao que você já usou pro Sales Rep. Pode sair e voltar quando quiser.
        </p>
      </div>

      {/* Stepper */}
      <Card className="p-5">
        <div className="flex items-center justify-between">
          {stepOrder.map((s, i) => {
            const done = i < stepIndex
            const current = s === step
            return (
              <button key={s} onClick={() => i <= stepIndex && goTo(s)} className="flex flex-1 flex-col items-center gap-1.5">
                <div className="flex w-full items-center">
                  <div
                    className="mx-auto flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-black transition-all"
                    style={
                      current
                        ? { background: meta.color, color: '#fff', boxShadow: `0 0 0 3px ${meta.color}30` }
                        : done
                          ? { background: brandGradient, color: '#fff' }
                          : { background: 'rgba(255,255,255,0.06)', color: '#64748b' }
                    }
                  >
                    {done ? <Check size={12} /> : i + 1}
                  </div>
                </div>
                <p className="hidden text-[9px] font-bold text-slate-500 sm:block">{STEP_LABEL[s]}</p>
              </button>
            )
          })}
        </div>
      </Card>

      <Card className="p-6">
        {step === 'about' && (
          <AboutStep
            meta={meta}
            unit={unit}
            config={config}
            onSaved={(saved) => {
              setConfig(saved)
              advance()
            }}
          />
        )}

        {step === 'interview' && config && (
          <div className="space-y-4">
            <p className="text-sm leading-relaxed text-slate-300">
              Hora de treinar: a <strong className="text-white">entrevista de contratação</strong>.{' '}
              Antes de começar a trabalhar, <strong className="text-white">{config.persona_name}</strong>{' '}
              precisa aprender sobre sua empresa. Responda como responderia a um funcionário novo — quando
              ele tiver aprendido tudo, ele mesmo avisa que está pronto e já começa a trabalhar.
            </p>
            <InterviewChat
              configId={config.id}
              personaName={config.persona_name}
              height="h-[420px]"
              onDone={() => {
                setConfig((c) => (c ? { ...c, interview_status: 'completed', is_active: true } : c))
                advance()
              }}
            />
          </div>
        )}

        {step === 'connect' && config && (
          <ConnectStep meta={meta} unit={unit} onContinue={advance} />
        )}

        {step === 'test' && config && (
          <div className="space-y-4">
            <p className="text-sm leading-relaxed text-slate-300">
              Converse com <strong className="text-white">{config.persona_name}</strong> como se fosse um
              cliente. Se alguma resposta não ficou boa, corrija ali mesmo.
            </p>
            {(agentType === 'sdr' || agentType === 'recruiter' || agentType === 'receptionist') && (
              <TestChat
                configId={config.id}
                unitId={unit.id}
                agentType={agentType}
                personaName={config.persona_name}
                testScenarios={[]}
              />
            )}
            <button
              onClick={advance}
              className="flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-black text-white"
              style={{ background: brandGradient, boxShadow: '0 4px 14px rgba(6,182,212,0.3)' }}
            >
              Concluir
              <ChevronRight size={14} />
            </button>
          </div>
        )}

        {step === 'done' && (
          <DoneStep meta={meta} personaName={config?.persona_name ?? meta.defaultName} />
        )}

        {!config && step !== 'about' && (
          <p className="text-sm text-red-400">Algo deu errado — volte pro passo &quot;Sobre&quot; e tente de novo.</p>
        )}
      </Card>

      {stepIndex > 0 && step !== 'done' && (
        <button
          onClick={() => goTo(stepOrder[stepIndex - 1]!)}
          className="self-start rounded-xl px-4 py-2 text-sm font-bold text-slate-400 hover:bg-white/5"
          style={{ border: '1px solid rgba(255,255,255,0.08)' }}
        >
          ← Voltar um passo
        </button>
      )}
    </div>
  )
}

// ─── Passo: sobre (nome + jeito de falar) ────────────────────────────────────

function AboutStep({
  meta,
  unit,
  config,
  onSaved,
}: {
  meta: (typeof EMPLOYEE_WIZARD_META)[WizardAgentType]
  unit: Unit
  config: AgentConfig | null
  onSaved: (config: AgentConfig) => void
}) {
  const [name, setName] = useState(config?.persona_name ?? meta.defaultName)
  const [tone, setTone] = useState<AgentTone>(config?.persona_tone ?? 'friendly')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    if (meta.askName && !name.trim()) {
      setError('Dê um nome pro seu funcionário — é o nome que aparece nas conversas.')
      return
    }
    setSaving(true)
    setError(null)
    const supabase = createClient()
    const payload = {
      unit_id: unit.id,
      agent_type: meta.agentType,
      persona_name: name.trim() || meta.defaultName,
      persona_tone: tone,
      daily_limit: config?.daily_limit ?? 15,
      active_hours: config?.active_hours ?? { start: '08:00', end: '18:00', days: [1, 2, 3, 4, 5] },
      is_active: config?.interview_status === 'completed',
    }
    const { data, error: saveError } = config
      ? await supabase.from('agent_configs').update(payload).eq('id', config.id).select('*').single()
      : await supabase.from('agent_configs').insert(payload).select('*').single()
    setSaving(false)
    if (saveError || !data) {
      setError('Não foi possível salvar. Tente de novo — se persistir, fale com suporte@alizo.com.br.')
      return
    }
    onSaved(data as AgentConfig)
  }

  return (
    <div className="space-y-5">
      <p className="text-sm leading-relaxed text-slate-300">
        {meta.askName ? (
          <>Ele vai atender pessoas de verdade pela unidade <strong className="text-white">{unit.name}</strong>. Aqui você define como ele se apresenta.</>
        ) : (
          <>Vamos contratar o <strong className="text-white">{meta.name}</strong> pra unidade <strong className="text-white">{unit.name}</strong>.</>
        )}
      </p>

      {meta.askName && (
        <div>
          <label className="mb-1.5 block text-xs font-bold text-slate-400">Nome do funcionário</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full max-w-sm rounded-xl px-4 py-3 text-sm text-white outline-none focus:border-cyan-500/50"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
            placeholder={`Ex: ${meta.defaultName}...`}
          />
        </div>
      )}

      {meta.askTone && (
        <div>
          <label className="mb-1.5 block text-xs font-bold text-slate-400">Jeito de falar</label>
          <div className="grid grid-cols-3 gap-3">
            {TONES.map(({ id, label, emoji, desc }) => (
              <button
                key={id}
                type="button"
                onClick={() => setTone(id)}
                className="flex flex-col items-center gap-1.5 rounded-xl p-4 transition-all"
                style={tone === id
                  ? { border: '1px solid rgba(6,182,212,0.5)', background: 'rgba(6,182,212,0.1)' }
                  : { border: '1px solid rgba(255,255,255,0.08)' }}
              >
                <span className="text-xl">{emoji}</span>
                <span className="text-xs font-bold text-slate-200">{label}</span>
                <span className="text-[10px] text-slate-500">{desc}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}

      <button
        onClick={handleSave}
        disabled={saving}
        className="flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-black text-white disabled:opacity-60"
        style={{ background: brandGradient, boxShadow: '0 4px 14px rgba(6,182,212,0.3)' }}
      >
        {saving ? <Loader2 size={14} className="animate-spin" /> : <ChevronRight size={14} />}
        {saving ? 'Salvando...' : 'Continuar pra entrevista'}
      </button>
    </div>
  )
}

// ─── Passo: conectar (varia por tipo de funcionário) ─────────────────────────

function ConnectStep({
  meta,
  unit,
  onContinue,
}: {
  meta: (typeof EMPLOYEE_WIZARD_META)[WizardAgentType]
  unit: Unit
  onContinue: () => void
}) {
  const cs = meta.connectStep

  if (cs.type === 'whatsapp') {
    return (
      <div className="space-y-5">
        <WhatsAppConnectStep unitId={unit.id} agentType={meta.agentType} alreadyConnected={!!unit.whatsapp_phone} onConnected={onContinue} />
        {!unit.whatsapp_phone && (
          <button
            onClick={onContinue}
            className="text-xs font-semibold text-slate-500 underline hover:text-slate-300"
          >
            Pular por enquanto e conectar depois
          </button>
        )}
        {!!unit.whatsapp_phone && (
          <button
            onClick={onContinue}
            className="flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-black text-white"
            style={{ background: brandGradient, boxShadow: '0 4px 14px rgba(6,182,212,0.3)' }}
          >
            Continuar
            <ChevronRight size={14} />
          </button>
        )}
      </div>
    )
  }

  if (cs.type === 'external-link') {
    return (
      <div className="space-y-5">
        <p className="text-sm leading-relaxed text-slate-300">{cs.description}</p>
        <div className="flex flex-wrap items-center gap-3">
          <a
            href={cs.href}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-black text-white"
            style={{ background: brandGradient, boxShadow: '0 4px 14px rgba(6,182,212,0.3)' }}
          >
            {cs.label}
            <ExternalLink size={14} />
          </a>
          <button
            onClick={onContinue}
            className="rounded-xl px-5 py-3 text-sm font-bold text-slate-300 hover:bg-white/5"
            style={{ border: '1px solid rgba(255,255,255,0.08)' }}
          >
            Já conectei, continuar
          </button>
        </div>
        <p className="text-xs text-slate-500">Abre em outra aba — esta tela continua aqui esperando você.</p>
      </div>
    )
  }

  if (cs.type === 'seo-audit') {
    return (
      <div className="space-y-5">
        <p className="text-sm leading-relaxed text-slate-300">
          Sem conexão externa necessária: ele já pode rodar a primeira auditoria técnica real do seu site agora.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <SeoAuditRunButton unitId={unit.id} />
          <button
            onClick={onContinue}
            className="rounded-xl px-5 py-3 text-sm font-bold text-slate-300 hover:bg-white/5"
            style={{ border: '1px solid rgba(255,255,255,0.08)' }}
          >
            Continuar
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <p className="text-sm leading-relaxed text-slate-300">{cs.description}</p>
      <button
        onClick={onContinue}
        className="flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-black text-white"
        style={{ background: brandGradient, boxShadow: '0 4px 14px rgba(6,182,212,0.3)' }}
      >
        Continuar
        <ChevronRight size={14} />
      </button>
    </div>
  )
}

// ─── Passo final ──────────────────────────────────────────────────────────────

function DoneStep({ meta, personaName }: { meta: (typeof EMPLOYEE_WIZARD_META)[WizardAgentType]; personaName: string }) {
  return (
    <div className="space-y-5 text-center">
      <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full" style={{ background: brandGradient, boxShadow: '0 0 40px rgba(6,182,212,0.4)' }}>
        <PartyPopper size={32} className="text-white" />
      </div>
      <div>
        <h3 className="text-xl font-black text-white">{personaName} está pronto!</h3>
        <p className="mt-2 text-sm text-slate-400">
          {meta.name} já está trabalhando pela sua empresa. Você acompanha tudo no painel dele — e pode
          pausar quando quiser.
        </p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Link
          href="/dashboard/equipe-digital"
          className="flex flex-1 items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold text-slate-300 hover:bg-white/5"
          style={{ border: '1px solid rgba(255,255,255,0.08)' }}
        >
          Ver equipe digital
        </Link>
        <Link
          href={meta.panelHref}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl py-3 text-sm font-black text-white"
          style={{ background: brandGradient, boxShadow: '0 4px 12px rgba(6,182,212,0.3)' }}
        >
          Ver o painel dele
          <Play size={14} />
        </Link>
      </div>
    </div>
  )
}
