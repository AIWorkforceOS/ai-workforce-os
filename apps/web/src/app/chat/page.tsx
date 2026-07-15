'use client'

import { Suspense, useState, useRef, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { Send, Bot, Sparkles } from 'lucide-react'

type Message = {
  id: string
  role: 'user' | 'assistant'
  content: string
  ts: number
}

type ChatMode = 'sales' | 'support' | 'traffic'

const INITIAL_MESSAGES: Record<ChatMode, string> = {
  sales:
    'Olá! Sou o **Kai**, seu consultor virtual do AI Workforce OS 👋\n\nEstou aqui para tirar todas as suas dúvidas e ajudar você a escolher o plano ideal para o seu negócio.\n\nComo posso te ajudar hoje?',
  support:
    'Olá! Sou o **Kai**, do suporte do AI Workforce OS 👋\n\nConte o que você está tentando fazer que eu te guio passo a passo.',
  traffic:
    'Olá! Sou o **Kai** e vou te ajudar a conectar suas contas de anúncio 👋\n\nVocê está travado no **Meta Ads** (Facebook/Instagram) ou no **Google Ads**?',
}

function renderMarkdown(text: string) {
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br/>')
}

export default function ChatPage() {
  return (
    <Suspense fallback={null}>
      <ChatPageInner />
    </Suspense>
  )
}

function ChatPageInner() {
  const searchParams = useSearchParams()
  const modeParam = searchParams.get('mode')
  const mode: ChatMode = modeParam === 'support' || modeParam === 'traffic' ? modeParam : 'sales'

  const initialMessage: Message = { id: 'init', role: 'assistant', content: INITIAL_MESSAGES[mode], ts: Date.now() }
  const [messages, setMessages] = useState<Message[]>([initialMessage])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  async function send(overrideText?: string) {
    const text = (overrideText ?? input).trim()
    if (!text || loading) return

    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: text, ts: Date.now() }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLoading(true)

    try {
      const apiMessages = [...messages, userMsg]
        .filter(m => m.id !== 'init')
        .map(m => ({ role: m.role, content: m.content }))

      // Include initial message as context
      const payload = [
        { role: 'user' as const, content: '(sistema: início da conversa)' },
        { role: 'assistant' as const, content: initialMessage.content },
        ...apiMessages,
      ]

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: payload, mode }),
      })

      const data = await res.json() as { reply?: string; error?: string }
      const reply = data.reply ?? 'Desculpe, tive um problema técnico. Tente novamente!'

      setMessages(prev => [...prev, {
        id: Date.now().toString() + '-ai',
        role: 'assistant',
        content: reply,
        ts: Date.now(),
      }])
    } catch {
      setMessages(prev => [...prev, {
        id: Date.now().toString() + '-err',
        role: 'assistant',
        content: 'Ops, tive um problema de conexão. Tente novamente em instantes!',
        ts: Date.now(),
      }])
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  const quickReplies =
    mode === 'traffic'
      ? ['Estou travado no Meta Ads', 'Estou travado no Google Ads', 'Deu erro ao testar a conexão']
      : mode === 'support'
        ? ['Como conecto o WhatsApp?', 'Como troco minha senha?', 'Como adiciono uma unidade?']
        : ['Como funciona?', 'Quanto custa?', 'Tem garantia?', 'Aceita PIX?']

  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: '#06090f',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        color: '#fff',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div style={{
        padding: '14px 16px',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        background: 'rgba(6,9,15,0.95)',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
      }}>
        <div style={{
          width: 36, height: 36, borderRadius: '50%',
          background: 'linear-gradient(135deg, #22c55e, #16a34a)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 0 12px rgba(34,197,94,0.4)',
        }}>
          <Bot size={16} color="white" />
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#fff' }}>Kai — Consultor IA</div>
          <div style={{ fontSize: 11, color: '#22c55e', display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', display: 'inline-block' }} />
            Online agora
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#52525b' }}>
          <Sparkles size={10} />
          OpenAI
        </div>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {messages.map(msg => (
          <div key={msg.id} style={{
            display: 'flex',
            justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
            gap: 8,
          }}>
            {msg.role === 'assistant' && (
              <div style={{
                width: 28, height: 28, borderRadius: '50%', flexShrink: 0, marginTop: 2,
                background: 'linear-gradient(135deg, #22c55e, #16a34a)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Bot size={12} color="white" />
              </div>
            )}
            <div style={{
              maxWidth: '80%',
              padding: '10px 14px',
              borderRadius: msg.role === 'user' ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
              background: msg.role === 'user'
                ? 'linear-gradient(135deg, #22c55e, #16a34a)'
                : 'rgba(255,255,255,0.06)',
              border: msg.role === 'assistant' ? '1px solid rgba(255,255,255,0.08)' : 'none',
              fontSize: 13,
              lineHeight: 1.6,
              color: msg.role === 'user' ? '#fff' : '#d4d4d8',
            }}
              dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
            />
          </div>
        ))}

        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 28, height: 28, borderRadius: '50%',
              background: 'linear-gradient(135deg, #22c55e, #16a34a)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Bot size={12} color="white" />
            </div>
            <div style={{
              padding: '10px 16px',
              borderRadius: '18px 18px 18px 4px',
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.08)',
            }}>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                {[0, 0.2, 0.4].map(delay => (
                  <div key={delay} style={{
                    width: 6, height: 6, borderRadius: '50%', background: '#22c55e',
                    animation: `bounce 1s ${delay}s infinite`,
                  }} />
                ))}
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Quick replies */}
      {messages.length <= 1 && (
        <div style={{ padding: '0 16px 8px', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {quickReplies.map(q => (
            <button
              key={q}
              onClick={() => send(q)}
              style={{
                padding: '6px 12px',
                borderRadius: 20,
                border: '1px solid rgba(34,197,94,0.3)',
                background: 'rgba(34,197,94,0.08)',
                color: '#86efac',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {q}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div style={{
        padding: '12px 16px',
        borderTop: '1px solid rgba(255,255,255,0.08)',
        background: 'rgba(6,9,15,0.95)',
        display: 'flex',
        gap: 8,
        alignItems: 'center',
      }}>
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Escreva sua dúvida..."
          style={{
            flex: 1,
            padding: '10px 14px',
            borderRadius: 12,
            border: '1px solid rgba(255,255,255,0.1)',
            background: 'rgba(255,255,255,0.05)',
            color: '#fff',
            fontSize: 13,
            outline: 'none',
          }}
        />
        <button
          onClick={() => send()}
          disabled={loading || !input.trim()}
          style={{
            width: 38, height: 38, borderRadius: 10, border: 'none', cursor: 'pointer',
            background: input.trim() ? 'linear-gradient(135deg, #22c55e, #16a34a)' : 'rgba(255,255,255,0.08)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'all 0.2s',
          }}
        >
          <Send size={15} color={input.trim() ? '#fff' : '#52525b'} />
        </button>
      </div>

      <style>{`
        @keyframes bounce {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
          40% { transform: translateY(-5px); opacity: 1; }
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }
      `}</style>
    </div>
  )
}
