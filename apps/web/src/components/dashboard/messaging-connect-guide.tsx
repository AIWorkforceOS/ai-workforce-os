'use client'

import { useState } from 'react'
import { Bot, MessageSquare } from 'lucide-react'
import { Card, brandGradient } from '@/components/ui/dashboard-ui'

type Step = { title: string; body: string }

const STEPS: Step[] = [
  {
    title: '1. Crie (ou acesse) sua conta Twilio',
    body: 'Em twilio.com, crie uma conta própria da sua empresa — nos EUA, o registro de SMS empresarial (A2P 10DLC) é feito por empresa, então cada cliente precisa da própria conta Twilio, não dá para compartilhar a de outra empresa.',
  },
  {
    title: '2. Copie Account SID e Auth Token',
    body: 'No Console da Twilio (console.twilio.com), a tela inicial já mostra "Account SID" e "Auth Token" (clique em "mostrar" para revelar o token). Copie os dois.',
  },
  {
    title: '3. Compre um número de telefone',
    body: 'Console → Phone Numbers → "Buy a number". Escolha um número com capacidade de SMS habilitada, no formato +1XXXXXXXXXX. Esse é o número que seus clientes vão receber mensagem e responder.',
  },
  {
    title: '4. Registre o número para SMS empresarial (A2P 10DLC)',
    body: 'Obrigatório nos EUA para enviar SMS em volume: Console → Messaging → Regulatory Compliance → "A2P 10DLC". Você vai precisar dos dados da empresa (EIN/registro comercial) para criar o "Brand" e depois a "Campaign". Custo aproximado: US$50-90 de setup único, mais US$1,50-10/mês por campanha. Sem isso as mensagens podem ser bloqueadas ou filtradas como spam pelas operadoras.',
  },
  {
    title: '5. Cole aqui e teste',
    body: 'Cole o Account SID, o Auth Token e o número Twilio no formulário ao lado e clique em "Testar e conectar". Ao conectar com sucesso, esta unidade passa a usar SMS como canal principal.',
  },
]

function StepList({ steps }: { steps: Step[] }) {
  return (
    <div className="flex flex-col gap-3">
      {steps.map((step) => (
        <div key={step.title} className="rounded-xl p-3.5" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
          <p className="text-xs font-black text-white">{step.title}</p>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">{step.body}</p>
        </div>
      ))}
    </div>
  )
}

export function MessagingConnectGuide() {
  return (
    <Card className="p-5">
      <p className="text-xs font-black uppercase tracking-widest text-slate-500">Passo a passo</p>
      <div className="mt-4">
        <StepList steps={STEPS} />
      </div>
    </Card>
  )
}

export function MessagingConnectKaiPanel() {
  const [chatOpen, setChatOpen] = useState(false)
  return (
    <Card className="overflow-hidden">
      <div className="p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: brandGradient, boxShadow: '0 4px 12px rgba(6,182,212,0.3)' }}>
            <Bot size={18} className="text-white" />
          </div>
          <div>
            <p className="text-sm font-black text-white">Travou em algum passo?</p>
            <p className="text-xs text-slate-500">O Kai te guia em tempo real, com paciência</p>
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
          <iframe src="/chat?mode=sms" className="w-full rounded-b-2xl" style={{ height: '420px', border: 'none' }} title="Kai — conexão de SMS" />
        </div>
      )}
    </Card>
  )
}
