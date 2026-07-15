'use client'

import { useState } from 'react'
import { Bot, MessageSquare } from 'lucide-react'
import { Card, brandGradient } from '@/components/ui/dashboard-ui'

type Step = { title: string; body: string }

const META_STEPS: Step[] = [
  {
    title: '1. Encontre o ID da conta de anúncio',
    body: 'No Meta Business Suite (business.facebook.com), clique no ícone de configurações e abra "Contas de anúncio". O número que aparece na lista é o ID — com ou sem o prefixo "act_", tanto faz.',
  },
  {
    title: '2. Gere o token de acesso',
    body: 'Configurações do negócio → Usuários → "Usuários do sistema". Crie um usuário do sistema Admin (se ainda não tiver), atribua a conta de anúncio a ele com permissão "Gerenciar campanhas" e clique em "Gerar novo token" marcando os escopos ads_read e ads_management. Copie o token assim que ele aparecer — ele só é mostrado uma vez.',
  },
  {
    title: '3. Cole aqui e teste',
    body: 'Cole o ID da conta e o token no formulário ao lado e clique em "Testar e conectar". Se a Alizo já for parceira no seu Business Manager, você só precisa do ID da conta.',
  },
]

const GOOGLE_STEPS: Step[] = [
  {
    title: '1. Aceite o vínculo com a Alizo',
    body: 'No Google Ads, abra Ferramentas e configurações (ícone de chave inglesa) → "Acesso e segurança" → aba "Contas de gerenciador". Aceite o convite pendente da Alizo. Se não tiver nenhum convite, peça pra equipe Alizo enviar.',
  },
  {
    title: '2. Encontre o Customer ID',
    body: 'Aparece no canto superior direito do Google Ads, no formato 123-456-7890. Pode colar com ou sem os hifens.',
  },
  {
    title: '3. Cole aqui e teste',
    body: 'Cole o Customer ID no formulário ao lado e clique em "Testar e conectar". Não precisa de nenhum token — o vínculo do passo 1 já autoriza a Alizo a operar a conta.',
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

export function TrafficConnectGuide() {
  const [platform, setPlatform] = useState<'meta' | 'google'>('meta')

  return (
    <Card className="p-5">
      <p className="text-xs font-black uppercase tracking-widest text-slate-500">Passo a passo</p>
      <div className="mt-3 flex gap-2">
        <button
          onClick={() => setPlatform('meta')}
          className="flex-1 rounded-lg py-2 text-xs font-bold transition-colors"
          style={platform === 'meta' ? { background: brandGradient, color: '#fff' } : { background: 'rgba(255,255,255,0.04)', color: '#94a3b8' }}
        >
          Meta Ads
        </button>
        <button
          onClick={() => setPlatform('google')}
          className="flex-1 rounded-lg py-2 text-xs font-bold transition-colors"
          style={platform === 'google' ? { background: brandGradient, color: '#fff' } : { background: 'rgba(255,255,255,0.04)', color: '#94a3b8' }}
        >
          Google Ads
        </button>
      </div>
      <div className="mt-4">
        <StepList steps={platform === 'meta' ? META_STEPS : GOOGLE_STEPS} />
      </div>
    </Card>
  )
}

export function TrafficConnectKaiPanel() {
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
            <p className="text-xs text-slate-500">O Kai te guia em tempo real, com prints e paciência</p>
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
          <iframe src="/chat?mode=traffic" className="w-full rounded-b-2xl" style={{ height: '420px', border: 'none' }} title="Kai — conexão de anúncios" />
        </div>
      )}
    </Card>
  )
}
