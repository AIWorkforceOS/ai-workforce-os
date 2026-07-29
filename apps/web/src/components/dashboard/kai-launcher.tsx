'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { Bot, MessageSquare, X } from 'lucide-react'
import { brandGradient } from '@/components/ui/dashboard-ui'

// Presença global da Kai: botão flutuante disponível em qualquer tela do
// dashboard, não só nas telas que já embutem um painel dedicado dela
// (onboarding, traffic/connect, content/connect, messaging/connect — essas
// continuam com o painel próprio, mais contextual, e escondem este botão
// pra não duplicar o widget na mesma tela).
const HIDDEN_ON = ['/dashboard/onboarding', '/dashboard/traffic/connect', '/dashboard/content/connect', '/dashboard/messaging/connect']

function modeForPath(pathname: string): 'support' | 'traffic' | 'content' {
  if (pathname.startsWith('/dashboard/traffic')) return 'traffic'
  if (pathname.startsWith('/dashboard/content')) return 'content'
  return 'support'
}

export function KaiLauncher() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  if (HIDDEN_ON.some((p) => pathname.startsWith(p))) return null

  const mode = modeForPath(pathname)

  return (
    <>
      <button
        onClick={() => setOpen((o) => !o)}
        className="fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full text-white transition-transform hover:scale-105"
        style={{ background: brandGradient, boxShadow: '0 8px 24px rgba(6,182,212,0.4)' }}
        title="Falar com o Kai"
      >
        {open ? <X size={22} /> : <Bot size={22} />}
      </button>

      {open && (
        <div
          className="fixed bottom-24 right-5 z-40 flex w-[92vw] max-w-[380px] flex-col overflow-hidden rounded-2xl"
          style={{ height: 'min(560px, 70vh)', background: '#0a0f1e', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 16px 48px rgba(0,0,0,0.5)' }}
        >
          <div className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            <MessageSquare size={13} className="text-cyan-400" />
            <span className="text-xs font-bold text-slate-300">Kai — assistente Alizo</span>
            <button onClick={() => setOpen(false)} className="ml-auto text-slate-500 hover:text-slate-300">
              <X size={14} />
            </button>
          </div>
          <iframe src={`/chat?mode=${mode}`} className="flex-1" style={{ border: 'none' }} title="Kai" />
        </div>
      )}
    </>
  )
}
