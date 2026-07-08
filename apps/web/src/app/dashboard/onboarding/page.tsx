'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  Bot, Check, Zap, MessageSquare, Play, ChevronRight,
  Wifi, Settings, Sparkles, ExternalLink,
} from 'lucide-react'
import { Card } from '@/components/ui/dashboard-ui'

const brandGradient = 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)'

const STEPS = [
  {
    id: 1,
    icon: Sparkles,
    title: 'Bem-vindo ao Alizo!',
    subtitle: 'Seu funcionário IA está pronto para ser configurado',
    color: '#06b6d4',
    content: WelcomeStep,
  },
  {
    id: 2,
    icon: Wifi,
    title: 'Conecte seu WhatsApp',
    subtitle: 'Leva menos de 2 minutos com o QR Code',
    color: '#25d366',
    content: WhatsAppStep,
  },
  {
    id: 3,
    icon: Bot,
    title: 'Configure seu funcionário IA',
    subtitle: 'Nome, personalidade e script de atendimento',
    color: '#818cf8',
    content: AgentStep,
  },
  {
    id: 4,
    icon: Play,
    title: 'Teste ao vivo',
    subtitle: 'Envie uma mensagem de teste e veja tudo funcionando',
    color: '#f59e0b',
    content: TestStep,
  },
  {
    id: 5,
    icon: Check,
    title: 'Tudo pronto! 🎉',
    subtitle: 'Seu funcionário IA já está trabalhando por você',
    color: '#4ade80',
    content: DoneStep,
  },
]

export default function OnboardingPage() {
  const [currentStep, setCurrentStep] = useState(1)
  const [chatOpen, setChatOpen] = useState(false)
  const [agentName, setAgentName] = useState('Kai')
  const [agentTone, setAgentTone] = useState('amigavel')

  const step = STEPS.find(s => s.id === currentStep)!
  const progress = ((currentStep - 1) / (STEPS.length - 1)) * 100

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-500">configuração</p>
          <h1 className="mt-0.5 text-2xl font-black tracking-tight text-white">Onboarding</h1>
        </div>
        <Link href="/dashboard" className="rounded-xl px-4 py-2 text-sm font-semibold text-slate-300 hover:bg-white/5" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
          Ir ao painel →
        </Link>
      </div>

      {/* Progress bar */}
      <Card className="p-6">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm font-bold text-slate-200">Progresso da configuração</p>
          <span className="text-sm font-black text-cyan-400">{Math.round(progress)}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${progress}%`, background: brandGradient }}
          />
        </div>

        {/* Step dots */}
        <div className="mt-4 flex items-center justify-between">
          {STEPS.map(s => (
            <button
              key={s.id}
              onClick={() => s.id <= currentStep && setCurrentStep(s.id)}
              className="flex flex-col items-center gap-1"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-black transition-all"
                style={s.id < currentStep
                  ? { background: brandGradient, color: '#fff' }
                  : s.id === currentStep
                    ? { background: s.color, color: '#fff', boxShadow: `0 0 0 3px ${s.color}30` }
                    : { background: 'rgba(255,255,255,0.06)', color: '#64748b' }}>
                {s.id < currentStep ? <Check size={12} /> : s.id}
              </div>
              <p className="hidden text-[9px] font-bold text-slate-500 sm:block">{s.title.split(' ')[0]}</p>
            </button>
          ))}
        </div>
      </Card>

      {/* Step content */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card className="overflow-hidden">
            {/* Step header */}
            <div className="p-6" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl" style={{ background: `${step.color}20` }}>
                  <step.icon size={20} style={{ color: step.color }} />
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                    Passo {currentStep} de {STEPS.length}
                  </p>
                  <h2 className="text-lg font-black text-white">{step.title}</h2>
                  <p className="text-sm text-slate-400">{step.subtitle}</p>
                </div>
              </div>
            </div>

            {/* Step body */}
            <div className="p-6">
              <step.content
                agentName={agentName}
                setAgentName={setAgentName}
                agentTone={agentTone}
                setAgentTone={setAgentTone}
              />
            </div>

            {/* Navigation */}
            <div className="flex items-center justify-between px-6 py-4" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <button
                onClick={() => currentStep > 1 && setCurrentStep(s => (s - 1) as typeof currentStep)}
                disabled={currentStep === 1}
                className="rounded-xl px-4 py-2 text-sm font-bold text-slate-400 disabled:opacity-30 hover:bg-white/5"
                style={{ border: '1px solid rgba(255,255,255,0.08)' }}
              >
                ← Voltar
              </button>
              {currentStep < STEPS.length ? (
                <button
                  onClick={() => setCurrentStep(s => (s + 1) as typeof currentStep)}
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

        {/* Help panel */}
        <div className="space-y-4">
          {/* AI Support button */}
          <Card className="overflow-hidden">
            <div className="p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: brandGradient, boxShadow: '0 4px 12px rgba(6,182,212,0.3)' }}>
                  <Bot size={18} className="text-white" />
                </div>
                <div>
                  <p className="text-sm font-black text-white">Precisa de ajuda?</p>
                  <p className="text-xs text-slate-500">Kai configura tudo por você</p>
                </div>
              </div>

              <p className="mt-3 text-xs text-slate-400 leading-relaxed">
                Nosso assistente IA pode te guiar em tempo real ou até fazer toda a configuração automaticamente enquanto você assiste.
              </p>

              <button
                onClick={() => setChatOpen(!chatOpen)}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-black text-white"
                style={{ background: brandGradient, boxShadow: '0 4px 12px rgba(6,182,212,0.3)' }}
              >
                <MessageSquare size={14} />
                {chatOpen ? 'Fechar chat' : 'Falar com Kai agora'}
              </button>
            </div>

            {/* Embedded support chat */}
            {chatOpen && (
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                <iframe
                  src="/chat?mode=support"
                  className="w-full rounded-b-2xl"
                  style={{ height: '400px', border: 'none' }}
                  title="Suporte IA"
                />
              </div>
            )}
          </Card>

          {/* Quick links */}
          <Card className="p-5">
            <p className="text-xs font-black uppercase tracking-widest text-slate-500">Recursos</p>
            <div className="mt-3 space-y-2">
              {[
                { label: 'Documentação completa', href: '#' },
                { label: 'Vídeo tutorial (5min)', href: '#' },
                { label: 'Suporte por e-mail', href: 'mailto:suporte@alizo.com.br' },
              ].map(({ label, href }) => (
                <a key={label} href={href}
                  className="flex items-center justify-between rounded-xl px-3 py-2.5 text-xs font-semibold text-slate-300 transition-colors hover:bg-white/5">
                  {label}
                  <ExternalLink size={11} className="text-slate-500" />
                </a>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}

// ─── Step components ─────────────────────────────────────────────────────────

function WelcomeStep(_props: StepProps) {
  return (
    <div className="space-y-5">
      <div className="rounded-2xl p-5" style={{ background: 'linear-gradient(135deg, rgba(6,182,212,0.1) 0%, rgba(67,97,238,0.06) 100%)', border: '1px solid rgba(6,182,212,0.2)' }}>
        <p className="text-sm font-bold text-cyan-300">🎉 Sua conta foi criada com sucesso!</p>
        <p className="mt-2 text-sm text-slate-300 leading-relaxed">
          Em menos de 10 minutos seu funcionário IA vai estar atendendo seus clientes 24 horas por dia, 7 dias por semana. Vamos configurar tudo juntos!
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          { step: '1', label: 'Conecte o WhatsApp', time: '2 min' },
          { step: '2', label: 'Configure o agente', time: '5 min' },
          { step: '3', label: 'Teste e ative', time: '2 min' },
        ].map(({ step, label, time }) => (
          <div key={step} className="rounded-xl p-4 text-center" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
            <div className="mx-auto flex h-8 w-8 items-center justify-center rounded-full text-sm font-black text-white" style={{ background: brandGradient }}>
              {step}
            </div>
            <p className="mt-2 text-xs font-bold text-slate-200">{label}</p>
            <p className="text-[10px] text-slate-500">{time}</p>
          </div>
        ))}
      </div>

      <p className="text-sm text-slate-400">
        Se preferir, nosso assistente Kai pode fazer toda a configuração por você — clique em &quot;Falar com Kai&quot; no painel ao lado.
      </p>
    </div>
  )
}

function WhatsAppStep(_props: StepProps) {
  return (
    <div className="space-y-5">
      <p className="text-sm text-slate-400">
        Para o seu funcionário IA atender via WhatsApp, precisamos conectar seu número ao sistema. É seguro e leva menos de 2 minutos.
      </p>

      <div className="space-y-3">
        {[
          { n: 1, text: 'Acesse o painel → Unidades → Selecione sua unidade' },
          { n: 2, text: 'Clique em "Conectar WhatsApp"' },
          { n: 3, text: 'Abra o WhatsApp no celular → Dispositivos conectados → Conectar dispositivo' },
          { n: 4, text: 'Escaneie o QR Code que aparecer na tela' },
          { n: 5, text: 'Pronto! O status ficará verde em alguns segundos' },
        ].map(({ n, text }) => (
          <div key={n} className="flex items-start gap-3">
            <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-black text-white"
              style={{ background: 'linear-gradient(135deg, #25d366, #128c7e)' }}>
              {n}
            </div>
            <p className="text-sm text-slate-300">{text}</p>
          </div>
        ))}
      </div>

      <Link
        href="/dashboard/units"
        className="flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-bold text-white w-fit"
        style={{ background: 'linear-gradient(135deg, #25d366, #128c7e)', boxShadow: '0 4px 12px rgba(37,211,102,0.25)' }}
      >
        <Wifi size={14} />
        Ir para conectar WhatsApp
      </Link>
    </div>
  )
}

function AgentStep({ agentName, setAgentName, agentTone, setAgentTone }: StepProps) {
  const fieldStyle = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }
  return (
    <div className="space-y-5">
      <p className="text-sm text-slate-400">
        Personalize seu funcionário IA. Ele vai usar essas configurações para atender seus clientes com o tom e nome da sua empresa.
      </p>

      <div className="space-y-4">
        <div>
          <label className="mb-1.5 block text-xs font-bold text-slate-400">Nome do funcionário IA</label>
          <input
            value={agentName}
            onChange={e => setAgentName(e.target.value)}
            className="w-full rounded-xl px-4 py-3 text-sm text-white outline-none focus:border-cyan-500/50"
            style={fieldStyle}
            placeholder="Ex: Kai, Sofia, Alex..."
          />
          <p className="mt-1 text-[11px] text-slate-500">Seus clientes vão ver esse nome no WhatsApp</p>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-bold text-slate-400">Tom de comunicação</label>
          <div className="grid grid-cols-3 gap-3">
            {[
              { id: 'amigavel', label: 'Amigável', emoji: '😊' },
              { id: 'profissional', label: 'Profissional', emoji: '💼' },
              { id: 'descontraido', label: 'Descontraído', emoji: '🤙' },
            ].map(({ id, label, emoji }) => (
              <button
                key={id}
                type="button"
                onClick={() => setAgentTone(id)}
                className="flex flex-col items-center gap-1.5 rounded-xl p-4 transition-all"
                style={agentTone === id
                  ? { border: '1px solid rgba(6,182,212,0.5)', background: 'rgba(6,182,212,0.1)' }
                  : { border: '1px solid rgba(255,255,255,0.08)' }}
              >
                <span className="text-xl">{emoji}</span>
                <span className="text-xs font-bold text-slate-200">{label}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-bold text-slate-400">Script de apresentação (opcional)</label>
          <textarea
            className="w-full rounded-xl px-4 py-3 text-sm text-white outline-none focus:border-cyan-500/50"
            style={fieldStyle}
            rows={3}
            placeholder={`Olá! Sou ${agentName}, assistente virtual da [Sua Empresa]. Como posso te ajudar hoje?`}
          />
        </div>
      </div>

      <Link href="/dashboard/agents" className="flex items-center gap-2 text-sm font-semibold hover:underline" style={{ color: '#22d3ee' }}>
        Configurações avançadas do agente
        <Settings size={13} />
      </Link>
    </div>
  )
}

function TestStep(_props: StepProps) {
  const [sent, setSent] = useState(false)

  return (
    <div className="space-y-5">
      <p className="text-sm text-slate-400">
        Antes de ativar, faça um teste rápido. Envie uma mensagem de teste para ver como seu funcionário IA vai responder aos seus clientes.
      </p>

      <div className="rounded-2xl p-5" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
        <div className="flex items-center gap-2 mb-3">
          <div className="h-8 w-8 rounded-full flex items-center justify-center" style={{ background: brandGradient }}>
            <Bot size={14} className="text-white" />
          </div>
          <span className="text-sm font-bold text-slate-200">Seu funcionário IA</span>
          <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: 'rgba(34,197,94,0.15)', color: '#4ade80' }}>
            Online
          </span>
        </div>

        {!sent ? (
          <button
            onClick={() => setSent(true)}
            className="flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-bold text-white"
            style={{ background: brandGradient }}
          >
            <Zap size={14} />
            Enviar mensagem de teste
          </button>
        ) : (
          <div className="space-y-3">
            <div className="flex justify-end">
              <div className="rounded-2xl px-4 py-2.5 text-sm text-white" style={{ background: brandGradient }}>
                Olá! Quero saber mais sobre os seus serviços
              </div>
            </div>
            <div className="flex items-start gap-2">
              <div className="h-7 w-7 flex-shrink-0 rounded-full flex items-center justify-center" style={{ background: brandGradient }}>
                <Bot size={12} className="text-white" />
              </div>
              <div className="rounded-2xl px-4 py-2.5 text-sm text-slate-300" style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)' }}>
                Olá! Sou o Kai, assistente virtual. Que ótimo que você entrou em contato! 😊 Posso te ajudar com informações sobre nossos serviços, agendar uma visita ou tirar qualquer dúvida. O que você gostaria de saber?
              </div>
            </div>
            <p className="text-xs font-semibold" style={{ color: '#4ade80' }}>✓ Funcionou! Seu agente está respondendo corretamente.</p>
          </div>
        )}
      </div>
    </div>
  )
}

function DoneStep(_props: StepProps) {
  return (
    <div className="space-y-5 text-center">
      <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full" style={{ background: brandGradient, boxShadow: '0 0 40px rgba(6,182,212,0.4)' }}>
        <Check size={36} className="text-white" />
      </div>
      <div>
        <h3 className="text-xl font-black text-white">Seu funcionário IA está ativo! 🎉</h3>
        <p className="mt-2 text-sm text-slate-400">
          A partir de agora, todos os clientes que mandarem mensagem no WhatsApp serão atendidos automaticamente, 24 horas por dia.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Resposta em', value: '< 3s' },
          { label: 'Disponível', value: '24/7' },
          { label: 'Leads/mês', value: '∞' },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-xl p-4 text-center" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
            <p className="text-2xl font-black text-cyan-400">{value}</p>
            <p className="mt-1 text-[11px] text-slate-500">{label}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Link href="/dashboard" className="flex flex-1 items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold text-slate-300 hover:bg-white/5" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
          Ver painel principal
        </Link>
        <Link href="/dashboard/leads" className="flex flex-1 items-center justify-center gap-2 rounded-xl py-3 text-sm font-black text-white"
          style={{ background: brandGradient, boxShadow: '0 4px 12px rgba(6,182,212,0.3)' }}>
          Ver meus leads
          <ChevronRight size={14} />
        </Link>
      </div>
    </div>
  )
}

type StepProps = {
  agentName: string
  setAgentName: (v: string) => void
  agentTone: string
  setAgentTone: (v: string) => void
}
