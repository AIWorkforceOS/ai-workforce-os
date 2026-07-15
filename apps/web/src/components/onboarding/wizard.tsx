'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Bot, Check, ChevronRight, Loader2, MessageSquare, PartyPopper,
  Play, Send, Smartphone, Sparkles, Wifi,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Card } from '@/components/ui/dashboard-ui'
import type { AgentConfig, AgentTone, Unit } from '@/lib/types'
import type { SetupStep } from '@/lib/setup-status'

const brandGradient = 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)'
const whatsGradient = 'linear-gradient(135deg, #25d366, #128c7e)'

type StepId = 'welcome' | 'whatsapp' | 'agent' | 'test' | 'done'

const STEP_META: { id: StepId; title: string; short: string; subtitle: string; icon: typeof Bot; color: string }[] = [
  { id: 'welcome', title: 'Bem-vindo ao Alizo!', short: 'Início', subtitle: 'Em 3 passos seu funcionário digital começa a atender', icon: Sparkles, color: '#06b6d4' },
  { id: 'whatsapp', title: 'Conecte seu WhatsApp', short: 'WhatsApp', subtitle: 'Escaneie o QR code com o celular da empresa', icon: Wifi, color: '#25d366' },
  { id: 'agent', title: 'Monte seu funcionário digital', short: 'Funcionário', subtitle: 'Nome e jeito de falar — salvos de verdade', icon: Bot, color: '#818cf8' },
  { id: 'test', title: 'Converse com ele antes de ligar', short: 'Teste', subtitle: 'Uma conversa real de teste, sem afetar clientes', icon: Play, color: '#f59e0b' },
  { id: 'done', title: 'Ligar o atendimento', short: 'Ativar', subtitle: 'A partir daqui ele trabalha sozinho, 24h por dia', icon: Check, color: '#4ade80' },
]

type WhatsStatus = 'open' | 'connecting' | 'close' | 'not_configured' | 'error' | 'loading'

export function OnboardingWizard({
  unit,
  config,
  initialSteps,
  firstName,
}: {
  unit: Unit | null
  config: AgentConfig | null
  initialSteps: SetupStep[]
  firstName: string
}) {
  const router = useRouter()

  const whatsappDone = initialSteps.find((s) => s.id === 'whatsapp')?.done ?? false
  const agentDone = initialSteps.find((s) => s.id === 'agent')?.done ?? false
  const activeDone = initialSteps.find((s) => s.id === 'active')?.done ?? false

  // Retoma de onde a pessoa parou — derivado do banco, não de estado local.
  const initialStep: StepId = !whatsappDone ? 'welcome' : !agentDone ? 'agent' : !activeDone ? 'test' : 'done'
  const [step, setStep] = useState<StepId>(initialStep)

  const stepIndex = STEP_META.findIndex((s) => s.id === step)
  const meta = STEP_META[stepIndex]!

  const doneFlags: Record<StepId, boolean> = {
    welcome: true,
    whatsapp: whatsappDone,
    agent: agentDone,
    test: agentDone, // teste é recomendado, não obrigatório
    done: activeDone,
  }
  const completedCount = [whatsappDone, agentDone, activeDone].filter(Boolean).length
  const progress = Math.round((completedCount / 3) * 100)

  if (!unit) {
    return (
      <Card className="mx-auto max-w-lg p-8 text-center">
        <h1 className="text-lg font-black text-white">Vamos criar sua primeira unidade</h1>
        <p className="mt-2 text-sm text-slate-400">
          Unidade é o local que seu funcionário digital atende (sua loja, clínica ou matriz).
          Crie a primeira para começar a configuração.
        </p>
        <Link
          href="/dashboard/units/new"
          className="mt-5 inline-block rounded-xl px-5 py-2.5 text-sm font-black text-white"
          style={{ background: brandGradient, boxShadow: '0 4px 14px rgba(6,182,212,0.3)' }}
        >
          Criar unidade
        </Link>
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-500">primeiros passos</p>
          <h1 className="mt-0.5 text-2xl font-black tracking-tight text-white">Configuração guiada</h1>
        </div>
        <Link href="/dashboard" className="rounded-xl px-4 py-2 text-sm font-semibold text-slate-300 hover:bg-white/5" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
          Ir ao painel →
        </Link>
      </div>

      {/* Progress */}
      <Card className="p-6">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm font-bold text-slate-200">
            {progress === 100 ? 'Tudo pronto! 🎉' : `Faltam ${3 - completedCount} de 3 etapas`}
          </p>
          <span className="text-sm font-black text-cyan-400">{progress}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
          <div className="h-full rounded-full transition-all duration-500" style={{ width: `${progress}%`, background: brandGradient }} />
        </div>

        <div className="mt-4 flex items-center justify-between">
          {STEP_META.map((s, i) => {
            const done = s.id !== 'welcome' && doneFlags[s.id] && s.id !== step
            return (
              <button key={s.id} onClick={() => setStep(s.id)} className="flex flex-col items-center gap-1">
                <div
                  className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-black transition-all"
                  style={
                    s.id === step
                      ? { background: s.color, color: '#fff', boxShadow: `0 0 0 3px ${s.color}30` }
                      : done
                        ? { background: brandGradient, color: '#fff' }
                        : { background: 'rgba(255,255,255,0.06)', color: '#64748b' }
                  }
                >
                  {done ? <Check size={12} /> : i + 1}
                </div>
                <p className="hidden text-[9px] font-bold text-slate-500 sm:block">{s.short}</p>
              </button>
            )
          })}
        </div>
      </Card>

      {/* Step body */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card className="overflow-hidden">
            <div className="p-6" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl" style={{ background: `${meta.color}20` }}>
                  <meta.icon size={20} style={{ color: meta.color }} />
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                    Passo {stepIndex + 1} de {STEP_META.length}
                  </p>
                  <h2 className="text-lg font-black text-white">{meta.title}</h2>
                  <p className="text-sm text-slate-400">{meta.subtitle}</p>
                </div>
              </div>
            </div>

            <div className="p-6">
              {step === 'welcome' && <WelcomeStep firstName={firstName} unitName={unit.name} onNext={() => setStep('whatsapp')} />}
              {step === 'whatsapp' && (
                <WhatsAppStep unitId={unit.id} alreadyConnected={whatsappDone} onConnected={() => { router.refresh() }} />
              )}
              {step === 'agent' && (
                <AgentStep unitId={unit.id} config={config} onSaved={() => { router.refresh() }} />
              )}
              {step === 'test' && <TestStep unitId={unit.id} personaName={config?.persona_name ?? 'Assistente'} />}
              {step === 'done' && (
                <ActivateStep
                  unitId={unit.id}
                  config={config}
                  alreadyActive={activeDone}
                  onActivated={() => { router.refresh() }}
                />
              )}
            </div>

            {/* Navegação */}
            <div className="flex items-center justify-between px-6 py-4" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <button
                onClick={() => stepIndex > 0 && setStep(STEP_META[stepIndex - 1]!.id)}
                disabled={stepIndex === 0}
                className="rounded-xl px-4 py-2 text-sm font-bold text-slate-400 disabled:opacity-30 hover:bg-white/5"
                style={{ border: '1px solid rgba(255,255,255,0.08)' }}
              >
                ← Voltar
              </button>
              {stepIndex < STEP_META.length - 1 ? (
                <button
                  onClick={() => setStep(STEP_META[stepIndex + 1]!.id)}
                  className="flex items-center gap-2 rounded-xl px-6 py-2.5 text-sm font-black text-white"
                  style={{ background: brandGradient, boxShadow: '0 4px 14px rgba(6,182,212,0.3)' }}
                >
                  Próximo passo
                  <ChevronRight size={14} />
                </button>
              ) : (
                <Link
                  href="/dashboard"
                  className="flex items-center gap-2 rounded-xl px-6 py-2.5 text-sm font-black text-white"
                  style={{ background: brandGradient, boxShadow: '0 4px 14px rgba(6,182,212,0.3)' }}
                >
                  Ir ao painel principal
                  <ChevronRight size={14} />
                </Link>
              )}
            </div>
          </Card>
        </div>

        {/* Painel de ajuda */}
        <div className="space-y-4">
          <HelpPanel />
        </div>
      </div>
    </div>
  )
}

// ─── Passo 1: boas-vindas ────────────────────────────────────────────────────

function WelcomeStep({ firstName, unitName, onNext }: { firstName: string; unitName: string; onNext: () => void }) {
  return (
    <div className="space-y-5">
      <div className="rounded-2xl p-5" style={{ background: 'linear-gradient(135deg, rgba(6,182,212,0.1) 0%, rgba(67,97,238,0.06) 100%)', border: '1px solid rgba(6,182,212,0.2)' }}>
        <p className="text-sm font-bold text-cyan-300">Olá, {firstName}! Sua conta está pronta. 🎉</p>
        <p className="mt-2 text-sm leading-relaxed text-slate-300">
          Vamos colocar o funcionário digital da <strong className="text-white">{unitName}</strong> pra
          trabalhar. São 3 etapas rápidas — e você vê o resultado em cada uma.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          { n: '1', label: 'Conectar o WhatsApp', desc: 'escaneando um QR code', time: '2 min' },
          { n: '2', label: 'Montar o funcionário', desc: 'nome e jeito de falar', time: '3 min' },
          { n: '3', label: 'Testar e ligar', desc: 'você conversa com ele antes', time: '2 min' },
        ].map(({ n, label, desc, time }) => (
          <div key={n} className="rounded-xl p-4 text-center" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
            <div className="mx-auto flex h-8 w-8 items-center justify-center rounded-full text-sm font-black text-white" style={{ background: brandGradient }}>
              {n}
            </div>
            <p className="mt-2 text-xs font-bold text-slate-200">{label}</p>
            <p className="text-[11px] text-slate-500">{desc}</p>
            <p className="mt-1 text-[10px] font-bold text-cyan-400">{time}</p>
          </div>
        ))}
      </div>

      <button
        onClick={onNext}
        className="flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-black text-white"
        style={{ background: brandGradient, boxShadow: '0 4px 14px rgba(6,182,212,0.3)' }}
      >
        Começar pela conexão do WhatsApp
        <ChevronRight size={14} />
      </button>
    </div>
  )
}

// ─── Passo 2: WhatsApp com QR inline ─────────────────────────────────────────

function WhatsAppStep({ unitId, alreadyConnected, onConnected }: { unitId: string; alreadyConnected: boolean; onConnected: () => void }) {
  const [status, setStatus] = useState<WhatsStatus>(alreadyConnected ? 'open' : 'loading')
  const [qrCode, setQrCode] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  async function fetchStatus(): Promise<WhatsStatus> {
    try {
      const res = await fetch(`/api/units/${unitId}/whatsapp/status`)
      const data = await res.json()
      const s: WhatsStatus = res.ok ? data.status : 'error'
      setStatus(s)
      return s
    } catch {
      setStatus('error')
      return 'error'
    }
  }

  useEffect(() => {
    fetchStatus()
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [unitId]) // fetchStatus é estável por render; refetch só quando muda a unidade

  async function handleConnect() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/units/${unitId}/whatsapp/connect`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Não foi possível gerar o QR code agora. Tente de novo em instantes.')
        setBusy(false)
        return
      }
      setQrCode(data.qrCode ?? null)
      setStatus('connecting')
      if (pollRef.current) clearInterval(pollRef.current)
      pollRef.current = setInterval(async () => {
        const current = await fetchStatus()
        if (current === 'open') {
          setQrCode(null)
          if (pollRef.current) clearInterval(pollRef.current)
          onConnected()
        }
      }, 3000)
    } catch {
      setError('Não foi possível iniciar a conexão. Verifique sua internet e tente de novo.')
    }
    setBusy(false)
  }

  if (status === 'open') {
    return (
      <div className="flex flex-col items-center gap-4 py-6 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full" style={{ background: whatsGradient, boxShadow: '0 0 30px rgba(37,211,102,0.35)' }}>
          <Check size={28} className="text-white" />
        </div>
        <div>
          <h3 className="text-lg font-black text-white">WhatsApp conectado!</h3>
          <p className="mt-1 text-sm text-slate-400">
            Seu número já está ligado à plataforma. Agora vamos montar o funcionário que vai atender por ele.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <p className="text-sm leading-relaxed text-slate-300">
        <strong className="text-white">Por que isso?</strong> É pelo seu WhatsApp que o funcionário
        digital vai conversar com seus clientes. A conexão é igual à do WhatsApp Web: você escaneia
        um QR code uma única vez, com o celular que tem o número da empresa.
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-3">
          {[
            { n: 1, text: 'Pegue o celular com o WhatsApp da empresa' },
            { n: 2, text: 'Abra WhatsApp → Configurações → Dispositivos conectados' },
            { n: 3, text: 'Toque em "Conectar dispositivo"' },
            { n: 4, text: 'Aponte a câmera pro QR code aqui do lado' },
          ].map(({ n, text }) => (
            <div key={n} className="flex items-start gap-3">
              <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-black text-white" style={{ background: whatsGradient }}>
                {n}
              </div>
              <p className="text-sm text-slate-300">{text}</p>
            </div>
          ))}
        </div>

        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl p-5" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
          {qrCode ? (
            <>
              <img
                src={qrCode.startsWith('data:') ? qrCode : `data:image/png;base64,${qrCode}`}
                alt="QR Code para conectar o WhatsApp"
                className="h-52 w-52 rounded-lg bg-white p-2"
              />
              <p className="text-center text-xs text-slate-400">
                Escaneie com o celular da empresa.<br />Assim que conectar, esta tela atualiza sozinha.
              </p>
            </>
          ) : (
            <>
              <Smartphone size={40} className="text-slate-600" />
              <button
                onClick={handleConnect}
                disabled={busy}
                className="flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-black text-white disabled:opacity-60"
                style={{ background: whatsGradient, boxShadow: '0 4px 12px rgba(37,211,102,0.25)' }}
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Wifi size={14} />}
                {busy ? 'Gerando QR code...' : 'Gerar QR code'}
              </button>
              {status === 'connecting' && <p className="text-xs text-amber-400">Aguardando você escanear…</p>}
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-xl px-4 py-3" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
          <p className="text-sm text-red-400">{error}</p>
          <p className="mt-1 text-xs text-slate-500">
            Se o problema continuar, pode pular este passo e conectar depois — ou fale com a gente em suporte@alizo.com.br.
          </p>
        </div>
      )}
    </div>
  )
}

// ─── Passo 3: montar o funcionário (salva de verdade) ────────────────────────

const TONES: { id: AgentTone; label: string; emoji: string; desc: string }[] = [
  { id: 'friendly', label: 'Amigável', emoji: '😊', desc: 'caloroso e próximo' },
  { id: 'professional', label: 'Profissional', emoji: '💼', desc: 'direto ao ponto' },
  { id: 'formal', label: 'Formal', emoji: '🎩', desc: 'cortês e respeitoso' },
]

function AgentStep({ unitId, config, onSaved }: { unitId: string; config: AgentConfig | null; onSaved: () => void }) {
  const [name, setName] = useState(config?.persona_name ?? '')
  const [tone, setTone] = useState<AgentTone>(config?.persona_tone ?? 'friendly')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(!!config)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    if (!name.trim()) {
      setError('Dê um nome pro seu funcionário — é o nome que seus clientes vão ver.')
      return
    }
    setSaving(true)
    setError(null)
    const supabase = createClient()
    const payload = {
      unit_id: unitId,
      agent_type: 'sdr',
      persona_name: name.trim(),
      persona_tone: tone,
      daily_limit: config?.daily_limit ?? 15,
      active_hours: config?.active_hours ?? { start: '08:00', end: '18:00', days: [1, 2, 3, 4, 5] },
      sectors: config?.sectors ?? ['tecnologia', 'industria', 'comercio', 'servicos'],
      is_active: config?.is_active ?? false,
    }
    const { error: saveError } = config
      ? await supabase.from('agent_configs').update(payload).eq('id', config.id)
      : await supabase.from('agent_configs').insert(payload)
    setSaving(false)
    if (saveError) {
      setError('Não foi possível salvar. Tente de novo — se persistir, fale com suporte@alizo.com.br.')
      return
    }
    setSaved(true)
    onSaved()
  }

  return (
    <div className="space-y-5">
      <p className="text-sm leading-relaxed text-slate-300">
        Seu funcionário digital atende clientes no WhatsApp: responde dúvidas, entende o que a
        pessoa precisa e encaminha pra você fechar. Aqui você define <strong className="text-white">como ele se apresenta</strong>.
      </p>

      <div>
        <label className="mb-1.5 block text-xs font-bold text-slate-400">Nome do funcionário</label>
        <input
          value={name}
          onChange={(e) => { setName(e.target.value); setSaved(false) }}
          className="w-full max-w-sm rounded-xl px-4 py-3 text-sm text-white outline-none focus:border-cyan-500/50"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
          placeholder="Ex: Kai, Sofia, Alex..."
        />
        <p className="mt-1 text-[11px] text-slate-500">Seus clientes vão ver esse nome nas conversas.</p>
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-bold text-slate-400">Jeito de falar</label>
        <div className="grid grid-cols-3 gap-3">
          {TONES.map(({ id, label, emoji, desc }) => (
            <button
              key={id}
              type="button"
              onClick={() => { setTone(id); setSaved(false) }}
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

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-black text-white disabled:opacity-60"
          style={{ background: brandGradient, boxShadow: '0 4px 14px rgba(6,182,212,0.3)' }}
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Bot size={14} />}
          {saving ? 'Salvando...' : saved ? 'Salvar alterações' : 'Salvar funcionário'}
        </button>
        {saved && !error && (
          <span className="flex items-center gap-1.5 text-sm font-semibold text-emerald-400">
            <Check size={14} /> Salvo!
          </span>
        )}
      </div>

      <p className="text-xs text-slate-500">
        Horários de atendimento e limites diários já vêm configurados com padrões seguros — dá pra
        ajustar depois em Configurações.
      </p>
    </div>
  )
}

// ─── Passo 4: teste de conversa real ─────────────────────────────────────────

type TestMessage = { role: 'user' | 'assistant'; content: string }

function TestStep({ unitId, personaName }: { unitId: string; personaName: string }) {
  const [messages, setMessages] = useState<TestMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function send(text: string) {
    const content = text.trim()
    if (!content || sending) return
    const next: TestMessage[] = [...messages, { role: 'user', content }]
    setMessages(next)
    setInput('')
    setSending(true)
    setError(null)
    try {
      const res = await fetch('/api/agent/sandbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unitId, messages: next }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Não foi possível gerar a resposta de teste.')
      } else {
        setMessages((m) => [...m, { role: 'assistant', content: data.reply }])
      }
    } catch {
      setError('Falha de conexão no teste. Tente de novo.')
    }
    setSending(false)
  }

  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-slate-300">
        Escreva como se você fosse um cliente chegando pelo WhatsApp.{' '}
        <strong className="text-white">{personaName}</strong> responde aqui usando exatamente a mesma
        inteligência do atendimento real — mas nada disso vai pros seus clientes.
      </p>

      <div className="flex h-72 flex-col rounded-2xl" style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)' }}>
        <div className="flex items-center gap-2 px-4 py-2.5" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="flex h-7 w-7 items-center justify-center rounded-full" style={{ background: brandGradient }}>
            <Bot size={12} className="text-white" />
          </div>
          <span className="text-sm font-bold text-slate-200">{personaName}</span>
          <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: 'rgba(245,158,11,0.15)', color: '#fbbf24' }}>
            Modo teste
          </span>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {messages.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
              <MessageSquare size={22} className="text-slate-600" />
              <p className="text-xs text-slate-500">Comece com algo que um cliente diria, por exemplo:</p>
              <button
                onClick={() => send('Oi! Queria saber mais sobre os serviços de vocês.')}
                className="rounded-full px-3 py-1.5 text-xs font-semibold text-cyan-300 hover:bg-white/5"
                style={{ border: '1px solid rgba(6,182,212,0.3)' }}
              >
                &quot;Oi! Queria saber mais sobre os serviços de vocês.&quot;
              </button>
            </div>
          )}
          {messages.map((m, i) =>
            m.role === 'user' ? (
              <div key={i} className="flex justify-end">
                <div className="max-w-[80%] rounded-2xl px-4 py-2.5 text-sm text-white" style={{ background: brandGradient }}>
                  {m.content}
                </div>
              </div>
            ) : (
              <div key={i} className="flex items-start gap-2">
                <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full" style={{ background: brandGradient }}>
                  <Bot size={12} className="text-white" />
                </div>
                <div className="max-w-[80%] rounded-2xl px-4 py-2.5 text-sm text-slate-200" style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)' }}>
                  {m.content}
                </div>
              </div>
            ),
          )}
          {sending && (
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Loader2 size={12} className="animate-spin" /> {personaName} está digitando…
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); send(input) }}
          className="flex items-center gap-2 p-3"
          style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Escreva como se fosse um cliente…"
            className="flex-1 rounded-xl px-4 py-2.5 text-sm text-white outline-none focus:border-cyan-500/50"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
          />
          <button
            type="submit"
            disabled={sending || !input.trim()}
            className="flex h-10 w-10 items-center justify-center rounded-xl text-white disabled:opacity-40"
            style={{ background: brandGradient }}
          >
            <Send size={14} />
          </button>
        </form>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  )
}

// ─── Passo 5: ativar ─────────────────────────────────────────────────────────

function ActivateStep({
  unitId,
  config,
  alreadyActive,
  onActivated,
}: {
  unitId: string
  config: AgentConfig | null
  alreadyActive: boolean
  onActivated: () => void
}) {
  const [active, setActive] = useState(alreadyActive)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleActivate() {
    if (!config) {
      setError('Antes de ligar, monte seu funcionário no passo 3.')
      return
    }
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const { error: err } = await supabase
      .from('agent_configs')
      .update({ is_active: true })
      .eq('id', config.id)
      .eq('unit_id', unitId)
    setBusy(false)
    if (err) {
      setError('Não foi possível ativar agora. Tente de novo.')
      return
    }
    setActive(true)
    onActivated()
  }

  if (active) {
    return (
      <div className="space-y-5 text-center">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full" style={{ background: brandGradient, boxShadow: '0 0 40px rgba(6,182,212,0.4)' }}>
          <PartyPopper size={32} className="text-white" />
        </div>
        <div>
          <h3 className="text-xl font-black text-white">Seu funcionário digital está trabalhando!</h3>
          <p className="mt-2 text-sm text-slate-400">
            Quem mandar mensagem no seu WhatsApp será atendido automaticamente. Você acompanha cada
            conversa em tempo real no painel — e pode assumir a conversa quando quiser.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Responde em', value: 'segundos' },
            { label: 'Disponível', value: '24/7' },
            { label: 'Você acompanha', value: 'tudo' },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-xl p-4 text-center" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
              <p className="text-lg font-black text-cyan-400">{value}</p>
              <p className="mt-1 text-[11px] text-slate-500">{label}</p>
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Link href="/dashboard" className="flex flex-1 items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold text-slate-300 hover:bg-white/5" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
            Ver painel principal
          </Link>
          <Link
            href="/dashboard/conversations"
            className="flex flex-1 items-center justify-center gap-2 rounded-xl py-3 text-sm font-black text-white"
            style={{ background: brandGradient, boxShadow: '0 4px 12px rgba(6,182,212,0.3)' }}
          >
            Acompanhar conversas
            <ChevronRight size={14} />
          </Link>
        </div>
        <p className="text-xs text-slate-500">
          Sabia que ele tem colegas? Você também pode ativar o{' '}
          <Link href="/dashboard/equipe-digital" className="font-semibold text-cyan-400 hover:underline">
            Recrutador (RH) e o Gestor de tráfego
          </Link>
          .
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <p className="text-sm leading-relaxed text-slate-300">
        Último passo! Ao ligar o atendimento, <strong className="text-white">{config?.persona_name ?? 'seu funcionário'}</strong>{' '}
        passa a responder automaticamente as mensagens que chegarem no WhatsApp conectado. Você pode
        desligar quando quiser.
      </p>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <button
        onClick={handleActivate}
        disabled={busy}
        className="flex items-center gap-2 rounded-xl px-8 py-3.5 text-sm font-black text-white disabled:opacity-60"
        style={{ background: 'linear-gradient(135deg, #22c55e, #16a34a)', boxShadow: '0 6px 20px rgba(34,197,94,0.3)' }}
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
        {busy ? 'Ativando...' : 'Ligar atendimento automático'}
      </button>
    </div>
  )
}

// ─── Ajuda lateral ───────────────────────────────────────────────────────────

function HelpPanel() {
  const [chatOpen, setChatOpen] = useState(false)
  return (
    <>
      <Card className="overflow-hidden">
        <div className="p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: brandGradient, boxShadow: '0 4px 12px rgba(6,182,212,0.3)' }}>
              <Bot size={18} className="text-white" />
            </div>
            <div>
              <p className="text-sm font-black text-white">Travou em algum passo?</p>
              <p className="text-xs text-slate-500">O Kai, assistente da Alizo, te guia em tempo real</p>
            </div>
          </div>
          <button
            onClick={() => setChatOpen(!chatOpen)}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-black text-white"
            style={{ background: brandGradient, boxShadow: '0 4px 12px rgba(6,182,212,0.3)' }}
          >
            <MessageSquare size={14} />
            {chatOpen ? 'Fechar chat' : 'Falar com o Kai'}
          </button>
        </div>
        {chatOpen && (
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <iframe src="/chat?mode=support" className="w-full rounded-b-2xl" style={{ height: '400px', border: 'none' }} title="Suporte IA" />
          </div>
        )}
      </Card>

      <Card className="p-5">
        <p className="text-xs font-black uppercase tracking-widest text-slate-500">Dúvidas comuns</p>
        <div className="mt-3 space-y-3 text-xs leading-relaxed text-slate-400">
          <p><strong className="text-slate-200">Preciso deixar o celular ligado?</strong><br />Não. Depois de escanear o QR, o atendimento roda na nuvem.</p>
          <p><strong className="text-slate-200">Ele responde qualquer mensagem?</strong><br />Sim, dentro do horário configurado — e passa pra você quando o assunto pede um humano.</p>
          <p><strong className="text-slate-200">Posso mudar tudo depois?</strong><br />Pode: nome, jeito de falar, horários e até desligar quando quiser.</p>
        </div>
        <a
          href="mailto:suporte@alizo.com.br"
          className="mt-4 block rounded-xl px-3 py-2.5 text-center text-xs font-semibold text-slate-300 hover:bg-white/5"
          style={{ border: '1px solid rgba(255,255,255,0.08)' }}
        >
          Falar com uma pessoa · suporte@alizo.com.br
        </a>
      </Card>
    </>
  )
}
