'use client'

import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, Bot, Check, FileText, Loader2, Paperclip, Send, Sparkles } from 'lucide-react'
import { brandGradient } from '@/components/ui/dashboard-ui'
import { createClient } from '@/lib/supabase/client'
import { EMPLOYEE_OPTIONS } from '@/components/dashboard/attachment-library-manager'

const ALL_EMPLOYEE_TYPES = EMPLOYEE_OPTIONS.map((o) => o.value)
const ATTACHMENT_MAX_BYTES = 15 * 1024 * 1024

// Entrevista de boas-vindas conduzida pela KAI — primeira tela que um
// cliente novo vê logo após o pagamento, ANTES de qualquer funcionário
// digital ser contratado. Pedido do Vinicius, 2026-08-24: "assim que o
// cliente novo entrar já abre uma tela com a KAI e ela dá as boas-vindas...
// depois disso a KAI mostra o caminho para as configurações do
// funcionário". Fala com /api/kai/onboarding (org-scoped, sem configId —
// diferente de InterviewChat, que é por funcionário).

type ChatEntry = { role: 'user' | 'assistant'; content: string }
type UploadedDoc = { name: string; status: 'uploading' | 'done' | 'error' }

export function KaiOnboardingChat({ companyName, orgId }: { companyName: string; orgId: string }) {
  const router = useRouter()
  const [messages, setMessages] = useState<ChatEntry[]>([])
  const [status, setStatus] = useState<'loading' | 'in_progress' | 'completed'>('loading')
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [uploadedDocs, setUploadedDocs] = useState<UploadedDoc[]>([])
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const startedRef = useRef(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

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

  // Documentos anexados durante o treinamento inicial (cardápio, tabela de
  // preços, política de atendimento etc.) — pedido do Vinicius (2026-08-26):
  // "poder anexar arquivos e ela poder estudar e aprender tudo". Reaproveita
  // exatamente o mesmo bucket/tabela da biblioteca de materiais
  // (attachment-library-manager.tsx), só que sempre org-wide (unit_id null)
  // e aplicável aos 6 funcionários — o objetivo aqui é a empresa toda
  // aprender de uma vez, não um material específico de um cargo.
  async function handleFilesSelected(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (files.length === 0) return

    const supabase = createClient()
    for (const file of files) {
      const isImage = file.type.startsWith('image/')
      const isPdf = file.type === 'application/pdf'
      if (!isImage && !isPdf) {
        setUploadedDocs((docs) => [...docs, { name: file.name, status: 'error' }])
        continue
      }
      if (file.size > ATTACHMENT_MAX_BYTES) {
        setUploadedDocs((docs) => [...docs, { name: file.name, status: 'error' }])
        continue
      }

      setUploadedDocs((docs) => [...docs, { name: file.name, status: 'uploading' }])
      try {
        const path = `${orgId}/${Date.now()}-${file.name}`
        const { error: uploadError } = await supabase.storage
          .from('employee-attachments')
          .upload(path, file, { upsert: true, contentType: file.type })
        if (uploadError) throw uploadError

        const { data: publicUrlData } = supabase.storage.from('employee-attachments').getPublicUrl(path)
        const fileUrl = publicUrlData.publicUrl

        let extractedText: string | null = null
        if (isPdf) {
          try {
            const extractRes = await fetch('/api/employee-attachments/extract-text', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ fileUrl, fileName: file.name }),
            })
            const extractJson = await extractRes.json().catch(() => null)
            extractedText = typeof extractJson?.text === 'string' ? extractJson.text : null
          } catch {
            extractedText = null
          }
        }

        const { error: insertError } = await supabase.from('employee_attachments').insert({
          org_id: orgId,
          unit_id: null,
          kind: isPdf ? 'pdf' : 'image',
          title: file.name,
          usage_instructions: 'Documento da empresa enviado durante o treinamento inicial com a KAI — use como fonte de verdade sobre a empresa.',
          file_url: fileUrl,
          file_name: file.name,
          extracted_text: extractedText,
          applicable_employees: ALL_EMPLOYEE_TYPES,
          is_active: true,
        })
        if (insertError) throw insertError

        setUploadedDocs((docs) => docs.map((d) => (d.name === file.name && d.status === 'uploading' ? { ...d, status: 'done' } : d)))
      } catch {
        setUploadedDocs((docs) => docs.map((d) => (d.name === file.name && d.status === 'uploading' ? { ...d, status: 'error' } : d)))
      }
    }
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

          {uploadedDocs.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {uploadedDocs.map((doc, i) => (
                <div
                  key={`${doc.name}-${i}`}
                  className="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs"
                  style={{
                    border: '1px solid rgba(255,255,255,0.1)',
                    background: 'rgba(255,255,255,0.03)',
                    color: doc.status === 'error' ? '#f87171' : doc.status === 'uploading' ? '#94a3b8' : '#67e8f9',
                  }}
                >
                  {doc.status === 'uploading' ? <Loader2 size={11} className="animate-spin" /> : <FileText size={11} />}
                  {doc.name}
                  {doc.status === 'error' && ' — falhou'}
                </div>
              ))}
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
              ref={fileInputRef}
              type="file"
              accept="application/pdf,image/*"
              multiple
              onChange={handleFilesSelected}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={status === 'loading'}
              title="Anexar documentos da empresa (cardápio, preços, políticas...)"
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl text-slate-400 transition-colors hover:text-cyan-300 disabled:opacity-40"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
            >
              <Paperclip size={14} />
            </button>
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
