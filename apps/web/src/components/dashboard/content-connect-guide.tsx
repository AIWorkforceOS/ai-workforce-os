'use client'

import { useState } from 'react'
import { Bot, MessageSquare } from 'lucide-react'
import { Card, brandGradient } from '@/components/ui/dashboard-ui'

// Guia lateral + chat da Kai da tela /dashboard/content/connect — mesmo
// padrão de traffic-connect-guide.tsx, mas só pra Página do Facebook
// (sem toggle de plataforma, já que aqui só existe o fluxo Meta).

type Step = { title: string; body: string }

function pageSteps(businessManagerId: string | null): Step[] {
  return [
    {
      title: '1. Encontre o ID da Página',
      body: 'Na sua Página do Facebook, abra Configurações → Acesso à Página (Nova experiência de Páginas). O ID da Página aparece lá em cima.',
    },
    {
      title: '2. Compartilhe a Página como Parceira (sem gerar token)',
      body: businessManagerId
        ? `Em "Acesso de parceiros", clique em "Atribuir um novo parceiro" → cole o ID do Business Manager da Alizo (${businessManagerId}) → conceda acesso de conteúdo (publicar e gerenciar posts). Não precisa gerar nenhum token.`
        : 'Em "Acesso de parceiros", clique em "Atribuir um novo parceiro" → cole o ID do Business Manager da Alizo (mostrado no formulário ao lado assim que a integração estiver disponível) → conceda acesso de conteúdo (publicar e gerenciar posts).',
    },
    {
      title: '3. Cole aqui e teste',
      body: 'Cole o ID da Página no formulário ao lado e clique em "Testar e conectar". Se a Página já tiver um Instagram Business vinculado, detectamos automaticamente.',
    },
  ]
}

export function ContentConnectGuide({ businessManagerId }: { businessManagerId: string | null }) {
  return (
    <Card className="p-5">
      <p className="text-xs font-black uppercase tracking-widest text-slate-500">Método manual (alternativa)</p>
      <p className="mt-1 text-[11px] text-slate-500">
        Normalmente basta clicar em &quot;Conectar com Facebook&quot; e fazer login — este passo a passo é só pra
        quem prefere compartilhar a Página manualmente em vez de logar.
      </p>
      <div className="mt-4 flex flex-col gap-3">
        {pageSteps(businessManagerId).map((step) => (
          <div key={step.title} className="rounded-xl p-3.5" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
            <p className="text-xs font-black text-white">{step.title}</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">{step.body}</p>
          </div>
        ))}
      </div>
    </Card>
  )
}

export function ContentConnectKaiPanel() {
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
          <iframe src="/chat?mode=content" className="w-full rounded-b-2xl" style={{ height: '420px', border: 'none' }} title="Kai — conexão de conteúdo/social" />
        </div>
      )}
    </Card>
  )
}
