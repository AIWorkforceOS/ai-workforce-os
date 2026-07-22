'use client'

import { useEffect, useRef, useState } from 'react'

export type DemoMessage = {
  from: 'lead' | 'ai'
  text: string
  time: string
}

export type DemoChatCopy = {
  agentName: string
  agentRole: string
  online: string
  messages: readonly DemoMessage[]
  outcome: string
  outcomeSub: string
  replay: string
}

const TYPING_MS = 1100
const LEAD_DELAY_MS = 1400
const AI_READ_DELAY_MS = 600
const RESTART_DELAY_MS = 7000

/**
 * Simulação animada de uma conversa comercial real (lead × funcionário IA).
 * Começa quando entra no viewport, digita mensagem a mensagem com indicador
 * de "digitando…" e, ao fechar a venda, mostra o desfecho e reinicia em loop.
 */
export function DemoChat({ copy }: { copy: DemoChatCopy }) {
  const [started, setStarted] = useState(false)
  const [shown, setShown] = useState(0)
  const [typing, setTyping] = useState(false)
  const [done, setDone] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Dispara a animação na primeira vez que o card aparece na tela.
  useEffect(() => {
    const el = rootRef.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      setStarted(true)
      return
    }
    const obs = new IntersectionObserver(
      entries => {
        if (entries[0]?.isIntersecting) {
          setStarted(true)
          obs.disconnect()
        }
      },
      { threshold: 0.35 },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  // Avança a conversa: lead entra após uma pausa; a IA "digita" antes de responder.
  useEffect(() => {
    if (!started) return
    const timers: ReturnType<typeof setTimeout>[] = []

    if (shown >= copy.messages.length) {
      timers.push(setTimeout(() => setDone(true), 500))
      timers.push(
        setTimeout(() => {
          setDone(false)
          setShown(0)
        }, RESTART_DELAY_MS),
      )
      return () => timers.forEach(clearTimeout)
    }

    const next = copy.messages[shown]
    if (!next) return

    if (next.from === 'ai') {
      timers.push(setTimeout(() => setTyping(true), AI_READ_DELAY_MS))
      timers.push(
        setTimeout(() => {
          setTyping(false)
          setShown(s => s + 1)
        }, AI_READ_DELAY_MS + TYPING_MS),
      )
    } else {
      timers.push(setTimeout(() => setShown(s => s + 1), shown === 0 ? 600 : LEAD_DELAY_MS))
    }
    return () => timers.forEach(clearTimeout)
  }, [started, shown, copy.messages])

  // Mantém a conversa rolada para a última mensagem.
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [shown, typing, done])

  return (
    <div
      ref={rootRef}
      className="relative mx-auto w-full max-w-md overflow-hidden rounded-3xl border border-white/10"
      style={{
        background: 'linear-gradient(180deg, rgba(15,21,32,0.95) 0%, rgba(8,12,20,0.98) 100%)',
        boxShadow: '0 24px 80px rgba(0,0,0,0.55), 0 0 0 1px rgba(6,182,212,0.08), 0 0 90px rgba(6,182,212,0.08)',
      }}
    >
      {/* Header do chat */}
      <div className="flex items-center gap-3 border-b border-white/[0.07] px-5 py-4"
        style={{ background: 'rgba(255,255,255,0.02)' }}>
        <div className="relative flex h-10 w-10 items-center justify-center rounded-full"
          style={{ background: 'linear-gradient(135deg, #06b6d4, #4361ee)' }}>
          <span className="text-sm font-black text-white">{copy.agentName.charAt(0)}</span>
          <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[#0b1018] bg-emerald-400" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-black text-white">
            {copy.agentName}
            <span className="ml-2 rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wide"
              style={{ background: 'rgba(6,182,212,0.15)', color: '#22d3ee' }}>
              {copy.agentRole}
            </span>
          </p>
          <p className="flex items-center gap-1.5 text-[11px] text-emerald-400">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
            {copy.online}
          </p>
        </div>
      </div>

      {/* Mensagens */}
      <div ref={scrollRef} className="h-[380px] space-y-3 overflow-y-auto px-4 py-5 md:h-[420px]">
        {copy.messages.slice(0, shown).map((m, i) => (
          <div key={i} className={`flex ${m.from === 'ai' ? 'justify-start' : 'justify-end'}`}
            style={{ animation: 'alz-msg-in 0.35s cubic-bezier(0.16,1,0.3,1)' }}>
            <div
              className="max-w-[82%] rounded-2xl px-4 py-2.5"
              style={
                m.from === 'ai'
                  ? {
                      background: 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(6,182,212,0.18)',
                      borderBottomLeftRadius: '6px',
                    }
                  : {
                      background: 'linear-gradient(135deg, rgba(6,182,212,0.28), rgba(67,97,238,0.28))',
                      border: '1px solid rgba(6,182,212,0.15)',
                      borderBottomRightRadius: '6px',
                    }
              }
            >
              <p className="text-[13px] leading-relaxed text-zinc-100">{m.text}</p>
              <p className={`mt-1 text-[10px] text-zinc-500 ${m.from === 'ai' ? '' : 'text-right'}`}>{m.time}</p>
            </div>
          </div>
        ))}

        {typing && (
          <div className="flex justify-start" style={{ animation: 'alz-msg-in 0.25s ease' }}>
            <div className="flex items-center gap-1 rounded-2xl px-4 py-3"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(6,182,212,0.18)', borderBottomLeftRadius: '6px' }}>
              {[0, 1, 2].map(i => (
                <span key={i} className="h-1.5 w-1.5 rounded-full bg-cyan-400"
                  style={{ animation: `alz-blink 1.2s ${i * 0.18}s infinite` }} />
              ))}
            </div>
          </div>
        )}

        {done && (
          <div className="flex justify-center pt-2" style={{ animation: 'alz-msg-in 0.45s cubic-bezier(0.16,1,0.3,1)' }}>
            <div className="rounded-2xl border border-emerald-400/25 px-5 py-3 text-center"
              style={{ background: 'rgba(52,211,153,0.08)' }}>
              <p className="text-sm font-black text-emerald-400">{copy.outcome}</p>
              <p className="mt-0.5 text-[11px] text-zinc-400">{copy.outcomeSub}</p>
            </div>
          </div>
        )}
      </div>

      {/* Rodapé */}
      <div className="border-t border-white/[0.07] px-5 py-3 text-center">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-600">{copy.replay}</p>
      </div>
    </div>
  )
}
