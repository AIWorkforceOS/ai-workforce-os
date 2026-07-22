'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Bot, Check, GraduationCap, Loader2, Send } from 'lucide-react'
import { brandGradient } from '@/components/ui/dashboard-ui'

// Chat da entrevista de contratação: o funcionário digital entrevista o
// dono/gestor para aprender a empresa antes de começar a trabalhar.
// Reutilizado pelo wizard de onboarding (SDR), pelo catálogo da equipe
// digital (Recrutador e Gestor de Tráfego) e pela página dedicada.
// Fala com /api/agent/interview e retoma a conversa de onde parou.

type ChatEntry = { role: 'user' | 'assistant'; content: string }

export function InterviewChat({
  configId,
  personaName,
  height = 'h-96',
  onDone,
  retrain = false,
}: {
  configId: string
  personaName: string
  /** classe tailwind de altura da área do chat */
  height?: string
  /** chamado quando a entrevista termina (funcionário ativado, ou retreinamento concluído) */
  onDone?: () => void
  /** true = refazer a entrevista de um funcionário já treinado, atualizando o perfil existente (migration 029) */
  retrain?: boolean
}) {
  const router = useRouter()
  const [messages, setMessages] = useState<ChatEntry[]>([])
  const [status, setStatus] = useState<'loading' | 'in_progress' | 'completed'>('loading')
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const startedRef = useRef(false)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, sending])

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    let cancelled = false

    async function bootstrap() {
      try {
        const res = await fetch(`/api/agent/interview?configId=${configId}${retrain ? '&retrain=1' : ''}`)
        const data = await res.json()
        if (cancelled) return
        if (!res.ok) {
          setError(data.error ?? 'Não foi possível carregar a entrevista.')
          setStatus('in_progress')
          return
        }
        const transcript: ChatEntry[] = Array.isArray(data.transcript) ? data.transcript : []
        setMessages(transcript)
        if (data.status === 'completed') {
          setStatus('completed')
          return
        }
        setStatus('in_progress')
        if (transcript.length === 0) {
          // Ainda não começou: pede a mensagem de abertura do funcionário
          setSending(true)
          const opening = await fetch('/api/agent/interview', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ configId, message: null, retrain }),
          })
          const openingData = await opening.json()
          if (cancelled) return
          setSending(false)
          if (!opening.ok) {
            setError(openingData.error ?? 'Não foi possível iniciar a entrevista.')
            return
          }
          setMessages([{ role: 'assistant', content: openingData.reply }])
        }
      } catch {
        if (!cancelled) {
          setError('Falha de conexão ao carregar a entrevista. Recarregue a página.')
          setStatus('in_progress')
          setSending(false)
        }
      }
    }

    bootstrap()
    return () => {
      cancelled = true
    }
  }, [configId])

  async function send(text: string) {
    const content = text.trim()
    if (!content || sending || status !== 'in_progress') return
    setMessages((m) => [...m, { role: 'user', content }])
    setInput('')
    setSending(true)
    setError(null)
    try {
      const res = await fetch('/api/agent/interview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ configId, message: content, retrain }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Não foi possível enviar. Tente de novo.')
      } else {
        setMessages((m) => [...m, { role: 'assistant', content: data.reply }])
        if (data.done) {
          setStatus('completed')
          onDone?.()
          router.refresh()
        }
      }
    } catch {
      setError('Falha de conexão. Tente de novo.')
    }
    setSending(false)
  }

  return (
    <div className="space-y-3">
      <div
        className={`flex flex-col rounded-2xl ${height}`}
        style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)' }}
      >
        <div className="flex items-center gap-2 px-4 py-2.5" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="flex h-7 w-7 items-center justify-center rounded-full" style={{ background: brandGradient }}>
            <GraduationCap size={12} className="text-white" />
          </div>
          <span className="text-sm font-bold text-slate-200">{personaName}</span>
          <span
            className="rounded-full px-2 py-0.5 text-[10px] font-bold"
            style={
              status === 'completed'
                ? { background: 'rgba(34,197,94,0.15)', color: '#4ade80' }
                : { background: 'rgba(6,182,212,0.15)', color: '#22d3ee' }
            }
          >
            {status === 'completed'
              ? retrain
                ? 'Retreinamento concluído'
                : 'Treinado e pronto'
              : retrain
                ? 'Retreinamento'
                : 'Entrevista de contratação'}
          </span>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {status === 'loading' && (
            <div className="flex h-full items-center justify-center gap-2 text-xs text-slate-500">
              <Loader2 size={14} className="animate-spin" /> Carregando a entrevista…
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
                <div
                  className="max-w-[80%] rounded-2xl px-4 py-2.5 text-sm text-slate-200"
                  style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)' }}
                >
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
          {status === 'completed' && (
            <div
              className="flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-bold text-emerald-300"
              style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.25)' }}
            >
              <Check size={14} />{' '}
              {retrain
                ? `Retreinamento concluído — ${personaName} atualizou o que sabe sobre a empresa.`
                : `Entrevista concluída — ${personaName} aprendeu sua empresa e já está trabalhando.`}
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {status !== 'completed' && (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              send(input)
            }}
            className="flex items-center gap-2 p-3"
            style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Responda como dono(a) da empresa…"
              disabled={status === 'loading'}
              className="flex-1 rounded-xl px-4 py-2.5 text-sm text-white outline-none focus:border-cyan-500/50 disabled:opacity-50"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
            />
            <button
              type="submit"
              disabled={sending || status === 'loading' || !input.trim()}
              className="flex h-10 w-10 items-center justify-center rounded-xl text-white disabled:opacity-40"
              style={{ background: brandGradient }}
            >
              <Send size={14} />
            </button>
          </form>
        )}
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  )
}
