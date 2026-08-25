'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, Bot, Check, Loader2, Send, Sparkles } from 'lucide-react'
import { brandGradient } from '@/components/ui/dashboard-ui'

// Entrevista de boas-vindas conduzida pela KAI — primeira tela que um
// cliente novo vê logo após o pagamento, ANTES de qualquer funcionário
// digital ser contratado. Pedido do Vinicius, 2026-08-24: "assim que o
// cliente novo entrar já abre uma tela com a KAI e ela dá as boas-vindas...
// depois disso a KAI mostra o caminho para as configurações do
// funcionário". Fala com /api/kai/onboarding (org-scoped, sem configId —
// diferente de InterviewChat, que é por funcionário).

type ChatEntry = { role: 'user' | 'assistant'; content: string }

export function KaiOnboardingChat({ companyName }: { companyName: string }) {
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
        const res = await fetch('/api/kai/onboarding')
        const data = await res.json()
        if (cancelled) return
        if (!res.ok) {
          setError(data.error ?? 'Não foi possível carregar a KAI.')
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
          setSending(true)
          const opening = await fetch('/api/kai/onboarding', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: null }),
          })
          const openingData = await opening.json()
          if (cancelled) return
          setSending(false)
          if (!opening.ok) {
            setError(openingData.error ?? 'Não foi possível iniciar a conversa.')
            return
          }
          setMessages([{ role: 'assistant', content: openingData.reply }])
        }
      } catch {
        if (!cancelled) {
          setError('Falha de conexão. Recarregue a página.')
          setStatus('in_progress')
          setSending(false)
        }
      }
    }

    bootstrap()
    return () => {
      cancelled = true
    }
  }, [])

  async function send(text: string) {
    const content = text.trim()
    if (!content || sending || status !== 'in_progress') return
    setMessages((m) => [...m, { role: 'user', content }])
    setInput('')
    setSending(true)
    setError(null)
    try {
      const res = await fetch('/api/kai/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: content }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Não foi possível enviar. Tente de novo.')
      } else {
        setMessages((m) => [...m, { role: 'assistant', content: data.reply }])
        if (data.done) {
          setStatus('completed')
          router.refresh()
        }
      }
    } catch {
      setError('Falha de conexão. Tente de novo.')
    }
    setSending(false)
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 px-4 py-10">
      <div className="flex items-center gap-2 text-slate-400">
        <Sparkles size={16} className="text-cyan-400" />
        <span className="text-xs font-bold uppercase tracking-wide">KAI — sua assistente Alizo</span>
      </div>

      <div
        className="flex flex-col rounded-2xl"
        style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)', minHeight: '32rem' }}
      >
        <div className="flex-1 space-y-3 overflow-y-auto p-5">
          {status === 'loading' && (
            <div className="flex h-full items-center justify-center gap-2 text-xs text-slate-500">
              <Loader2 size={14} className="animate-spin" /> A KAI está se preparando…
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
              <Loader2 size={12} className="animate-spin" /> KAI está digitando…
            </div>
          )}

          {status === 'completed' && (
            <div className="space-y-4">
              <div
                className="flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-bold text-emerald-300"
                style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.25)' }}
              >
                <Check size={14} /> A KAI já conhece a {companyName} — agora é escolher qual funcionário digital
                começa a trabalhar primeiro.
              </div>
              <button
                onClick={() => router.push('/dashboard/equipe-digital')}
                className="flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-bold text-white transition-all hover:scale-[1.01]"
                style={{ background: brandGradient }}
              >
                Ver funcionários digitais e começar a configurar <ArrowRight size={14} />
              </button>
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
