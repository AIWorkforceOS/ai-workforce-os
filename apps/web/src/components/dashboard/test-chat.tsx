'use client'

import { useEffect, useRef, useState } from 'react'
import { Bot, Check, FlaskConical, Loader2, PenLine, Send } from 'lucide-react'
import { brandGradient } from '@/components/ui/dashboard-ui'
import type { TestScenario } from '@/lib/verticals/catalog'

// Chat de teste do funcionário digital (sub-etapa 5/7): simula uma
// conversa com o MESMO prompt do atendimento real (via /api/agent/sandbox),
// mas 100% em memória — nada aqui vai pra conversations/leads/customers
// nem dispara WhatsApp/SMS/e-mail de verdade. Cada resposta pode ser
// corrigida; a correção é salva (texto puro, sem chamar IA de novo) em
// /api/agent/training-correction e passa a valer nas conversas reais.

type TestMessage = { role: 'user' | 'assistant'; content: string }

export function TestChat({
  configId,
  unitId,
  agentType,
  personaName,
  testScenarios,
}: {
  configId: string
  unitId: string
  agentType: 'sdr' | 'recruiter' | 'receptionist'
  personaName: string
  testScenarios: TestScenario[]
}) {
  const [messages, setMessages] = useState<TestMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [correctingIndex, setCorrectingIndex] = useState<number | null>(null)
  const [correctionText, setCorrectionText] = useState('')
  const [savingCorrection, setSavingCorrection] = useState(false)
  const [savedIndices, setSavedIndices] = useState<Set<number>>(new Set())
  const bottomRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, sending])

  async function sendMessage(content: string, base: TestMessage[]) {
    const text = content.trim()
    if (!text || sending) return
    const next: TestMessage[] = [...base, { role: 'user', content: text }]
    setMessages(next)
    setSending(true)
    setError(null)
    try {
      const res = await fetch('/api/agent/sandbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unitId, agentType, messages: next }),
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

  function handleSend() {
    sendMessage(input, messages)
    setInput('')
  }

  function handleScenario(scenario: TestScenario) {
    setCorrectingIndex(null)
    setSavedIndices(new Set())
    sendMessage(scenario.openingMessage, [])
  }

  function lastUserMessageBefore(index: number): string {
    for (let i = index - 1; i >= 0; i--) {
      if (messages[i]?.role === 'user') return messages[i]!.content
    }
    return ''
  }

  async function submitCorrection(index: number) {
    const text = correctionText.trim()
    if (!text || savingCorrection) return
    const assistantMsg = messages[index]
    if (!assistantMsg) return
    const context = `Cliente simulado disse: "${lastUserMessageBefore(index)}" — o funcionário respondeu: "${assistantMsg.content}"`
    setSavingCorrection(true)
    try {
      const res = await fetch('/api/agent/training-correction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ configId, context, correction: text }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Não foi possível salvar a correção.')
      } else {
        setSavedIndices((s) => new Set(s).add(index))
        setCorrectingIndex(null)
        setCorrectionText('')
      }
    } catch {
      setError('Falha de conexão ao salvar a correção. Tente de novo.')
    }
    setSavingCorrection(false)
  }

  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-slate-300">
        Escreva como se você fosse um cliente chegando pra falar com{' '}
        <strong className="text-white">{personaName}</strong>. Ele(a) responde aqui usando exatamente
        a mesma inteligência do atendimento real — mas nada disso é enviado de verdade nem gravado
        nos seus clientes/leads.
      </p>

      {testScenarios.length > 0 && (
        <div>
          <p className="mb-1.5 text-[10px] font-black uppercase tracking-widest text-slate-500">
            Cenários prontos
          </p>
          <div className="flex flex-wrap gap-2">
            {testScenarios.map((scenario) => (
              <button
                key={scenario.title}
                type="button"
                onClick={() => handleScenario(scenario)}
                disabled={sending}
                className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-cyan-300 hover:bg-white/5 disabled:opacity-50"
                style={{ border: '1px solid rgba(6,182,212,0.3)' }}
              >
                <FlaskConical size={11} /> {scenario.title}
              </button>
            ))}
          </div>
        </div>
      )}

      <div
        className="flex h-[420px] flex-col rounded-2xl"
        style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)' }}
      >
        <div className="flex items-center gap-2 px-4 py-2.5" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="flex h-7 w-7 items-center justify-center rounded-full" style={{ background: brandGradient }}>
            <Bot size={12} className="text-white" />
          </div>
          <span className="text-sm font-bold text-slate-200">{personaName}</span>
          <span
            className="rounded-full px-2 py-0.5 text-[10px] font-bold"
            style={{ background: 'rgba(245,158,11,0.15)', color: '#fbbf24' }}
          >
            Modo teste
          </span>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {messages.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
              <FlaskConical size={22} className="text-slate-600" />
              <p className="text-xs text-slate-500">
                Escolha um cenário acima ou escreva livremente como um cliente faria.
              </p>
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
                <div className="max-w-[80%] space-y-1.5">
                  <div
                    className="rounded-2xl px-4 py-2.5 text-sm text-slate-200"
                    style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)' }}
                  >
                    {m.content}
                  </div>
                  {savedIndices.has(i) ? (
                    <p className="flex items-center gap-1 text-[11px] font-semibold text-emerald-400">
                      <Check size={11} /> Correção salva — vale para as próximas conversas.
                    </p>
                  ) : correctingIndex === i ? (
                    <div className="space-y-1.5">
                      <textarea
                        value={correctionText}
                        onChange={(e) => setCorrectionText(e.target.value)}
                        placeholder="O que ele deveria ter respondido ou feito diferente?"
                        rows={2}
                        className="w-full rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-cyan-500/50"
                        style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
                      />
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => submitCorrection(i)}
                          disabled={savingCorrection || !correctionText.trim()}
                          className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-50"
                          style={{ background: brandGradient }}
                        >
                          {savingCorrection ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />}
                          Salvar correção
                        </button>
                        <button
                          type="button"
                          onClick={() => { setCorrectingIndex(null); setCorrectionText('') }}
                          className="text-[11px] font-semibold text-slate-500 hover:text-slate-300"
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => { setCorrectingIndex(i); setCorrectionText('') }}
                      className="flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-slate-300"
                    >
                      <PenLine size={10} /> Corrigir esta resposta
                    </button>
                  )}
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
          onSubmit={(e) => { e.preventDefault(); handleSend() }}
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
