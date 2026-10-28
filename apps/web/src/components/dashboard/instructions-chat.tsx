'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Send } from 'lucide-react'
import type { InstructionConflict, ParsedInterpretation } from '@/lib/content/instructions'

type ChatMessage = { role: 'user' | 'assistant'; content: string }
type Proposal = { proposal: ParsedInterpretation; conflicts: InstructionConflict[]; confirmation: string; affectedPostCount: number }

const brDate = (d: string) => d.split('-').reverse().join('/')

/**
 * Conversa de "Instruções": o dono escreve, o agente confirma o que entendeu (ou pergunta o mínimo) e só grava depois
 * do "Confirmar". Mostra conflitos (com opção de substituir) e quantos posts já agendados serão alcançados.
 */
export function InstructionsChat({ unitId }: { unitId: string }) {
  const router = useRouter()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [replace, setReplace] = useState<Set<string>>(new Set())
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  const firstUserText = messages.find((m) => m.role === 'user')?.content ?? ''
  const fullOwnerText = messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n')

  async function send() {
    const text = input.trim()
    if (!text || busy) return
    const next: ChatMessage[] = [...messages, { role: 'user', content: text }]
    setMessages(next)
    setInput('')
    setProposal(null)
    setNotice(null)
    setBusy(true)
    try {
      const res = await fetch('/api/content/instructions/interpret', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unit_id: unitId, messages: next }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Erro ao interpretar.')
      if (data.kind === 'blocked') {
        setMessages([...next, { role: 'assistant', content: `Não posso aplicar isso: ${data.reason}` }])
      } else if (data.kind === 'questions') {
        setMessages([...next, { role: 'assistant', content: (data.questions as string[]).join('\n') }])
      } else {
        setMessages([...next, { role: 'assistant', content: data.confirmation }])
        setProposal({ proposal: data.proposal, conflicts: data.conflicts, confirmation: data.confirmation, affectedPostCount: data.affectedPostCount ?? 0 })
        setReplace(new Set())
      }
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Erro ao interpretar.' })
    } finally {
      setBusy(false)
      setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
    }
  }

  async function confirm() {
    if (!proposal || busy) return
    setBusy(true)
    setNotice(null)
    try {
      const res = await fetch('/api/content/instructions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          unit_id: unitId,
          original_text: fullOwnerText || firstUserText,
          proposal: { ...proposal.proposal.interpretation, starts_on: proposal.proposal.starts_on, ends_on: proposal.proposal.ends_on, priority: proposal.proposal.priority },
          replace_ids: [...replace],
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Não foi possível salvar.')
      const review = (data.reviewPosts as unknown[]).length
      setNotice({
        tone: 'ok',
        text:
          review > 0
            ? `Instrução salva. ${review} post(s) já agendado(s) nesse período foram gerados antes dela — revise-os na fila de aprovação (nada foi alterado ou publicado automaticamente).`
            : 'Instrução salva. Os próximos posts do período já seguem essa instrução.',
      })
      setMessages([])
      setProposal(null)
      router.refresh()
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Não foi possível salvar.' })
    } finally {
      setBusy(false)
    }
  }

  const p = proposal?.proposal
  return (
    <div className="flex flex-col gap-3 rounded-2xl p-4" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
      <div className="flex max-h-[420px] min-h-[120px] flex-col gap-2 overflow-y-auto">
        {messages.length === 0 && (
          <p className="text-sm text-slate-400">
            Conte o que a empresa precisa neste período, do seu jeito. Ex.: “De 01/11 a 16/11, captar clientes comerciais com carrosséis e vídeos curtos, para gestores de facilities.” Eu confirmo o que entendi antes de valer.
          </p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={`max-w-[88%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${m.role === 'user' ? 'self-end bg-cyan-500/20 text-cyan-50' : 'self-start bg-white/5 text-slate-200'}`}
          >
            {m.content}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {p && proposal && (
        <div className="rounded-xl p-3 text-xs text-slate-300" style={{ background: 'rgba(6,182,212,0.08)', border: '1px solid rgba(6,182,212,0.25)' }}>
          <p className="font-bold text-cyan-300">Resumo do que será aplicado</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            <li>Objetivo: {p.interpretation.objective}</li>
            {p.interpretation.audience && <li>Público: {p.interpretation.audience}</li>}
            <li>Período: {brDate(p.starts_on)} {p.ends_on ? `a ${brDate(p.ends_on)}` : '(sem data final)'}</li>
            {p.interpretation.formats.length > 0 && <li>Formatos: {p.interpretation.formats.join(', ')}</li>}
            {p.interpretation.cta && <li>Chamada para ação: {p.interpretation.cta}</li>}
            {p.interpretation.slide_backgrounds && <li>Carrosséis com imagens de fundo nos slides</li>}
            {p.interpretation.restrictions.length > 0 && <li>Restrições: {p.interpretation.restrictions.join('; ')}</li>}
            <li>Prioridade: {p.priority === 'alta' ? 'alta' : 'normal'}</li>
          </ul>
          {p.interpretation.formats.some((f) => /carross?el|carousel/i.test(f)) && (
            <p className="mt-1.5 text-amber-300">Carrosséis são criados e ficam aguardando a sua aprovação. A publicação automática de carrossel ainda não foi liberada.</p>
          )}
          {p.interpretation.formats.some((f) => /v[ií]deo|video|reel/i.test(f)) && (
            <p className="mt-1.5 text-amber-300">Vídeos curtos (9:16, só texto na tela) são criados e ficam aguardando a sua aprovação — no máximo 2 por rodada de planejamento. A publicação automática de vídeo ainda não foi liberada.</p>
          )}
          {proposal.conflicts.length > 0 && (
            <div className="mt-2 space-y-1 rounded-lg bg-amber-500/10 p-2 text-amber-200">
              <p className="font-bold">Conflito com instruções existentes</p>
              {proposal.conflicts.map((c) => (
                <label key={c.instructionId} className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={replace.has(c.instructionId)}
                    onChange={(e) => {
                      const next = new Set(replace)
                      if (e.target.checked) next.add(c.instructionId)
                      else next.delete(c.instructionId)
                      setReplace(next)
                    }}
                    className="mt-0.5"
                  />
                  <span>{c.message} <span className="text-amber-400">Marque para substituir a antiga; desmarcado, as duas convivem e vale a de maior prioridade/mais nova.</span></span>
                </label>
              ))}
            </div>
          )}
          {proposal.affectedPostCount > 0 && (
            <p className="mt-2 text-slate-300">{proposal.affectedPostCount} post(s) já agendado(s) nesse período não seguem esta instrução. Eu os listo para você revisar — nada é alterado sozinho e o que já foi publicado não é tocado.</p>
          )}
          <button
            type="button"
            onClick={confirm}
            disabled={busy}
            className="mt-3 rounded-xl bg-cyan-500 px-4 py-2 text-xs font-black text-slate-950 disabled:opacity-50"
          >
            {busy ? 'Salvando…' : 'Confirmar e aplicar'}
          </button>
        </div>
      )}

      {notice && (
        <p className={`rounded-lg px-3 py-2 text-xs ${notice.tone === 'ok' ? 'bg-emerald-500/10 text-emerald-300' : 'bg-red-500/10 text-red-300'}`}>{notice.text}</p>
      )}

      <div className="flex items-end gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send()
            }
          }}
          rows={2}
          placeholder={proposal ? 'Quer ajustar algo? Escreva aqui (ou confirme acima).' : 'Escreva a instrução…'}
          className="min-h-[44px] flex-1 resize-none rounded-xl bg-white/5 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-cyan-400/50"
        />
        <button type="button" onClick={() => void send()} disabled={busy || !input.trim()} aria-label="Enviar" className="flex h-11 w-11 items-center justify-center rounded-xl bg-cyan-500 text-slate-950 disabled:opacity-40">
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
        </button>
      </div>
    </div>
  )
}
