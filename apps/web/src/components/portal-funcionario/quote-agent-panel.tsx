'use client'

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { AlertTriangle, Camera, CheckCircle2, FileDown, ImagePlus, Loader2, Pencil, RefreshCw, Send, Sparkles, X } from 'lucide-react'
import { Input, Label, Textarea } from '@/components/ui/dashboard-ui'
import { localId, type StoredFile } from '@/lib/portal-funcionario/offline-store'
import { saveViaQueue } from '@/lib/portal-funcionario/live-save'

/**
 * Super Agente de Cotações — painel do técnico DENTRO da WO. Fluxo: Gerar Cotação com IA → (perguntas do agente, com fotos e texto)
 * → relatório técnico editável → solicitar revisão ou aprovar → PDF. O processamento roda no servidor: pode fechar o app. Aqui só aparece
 * a camada TÉCNICA (preços de COMPRA dos materiais, quantidades, horas); nenhum valor comercial chega a esta tela (a API não os envia).
 */

type Row = Record<string, unknown>
type Msg = { id: string; role: 'agent' | 'technician' | 'admin' | 'system'; kind: string; body: string | null; media: { url: string }[]; questions: { id: string; kind: string; request_pt: string }[]; created_at: string }
type Item = Row & { id: string; name_en: string; quantity: number; unit: string; kind: string; necessity: string; price_status: string; unit_price_usd: string | null; subtotal_usd: string | null }
type Draft = { draft: Row & { id: string; status: string; version: number; technical_check: string; warnings?: string[]; tech_text_pt?: string | null; diagnosis?: Diagnosis | null }; items: Item[]; options: Row[]; labor: Row | null; media: Row[]; totals: { materials_usd: string | null; pending_price_count: number; partial: boolean } }
type Diagnosis = {
  summary_pt: string
  problem_en: string
  evidence: { fact: string; photo_refs: number[]; confidence: string }[]
  hypotheses: { text: string; confidence: string }[]
  identified: { brand: string | null; model: string | null; part_numbers: string[]; labels_read: string[] }
  additional_info_needed: { kind: string; request_pt: string }[]
  safety_risks: { risk: string; severity: string }[]
  scope_pt: string
  visual_confidence: string
}
type AgentState = {
  status: { code: string; label: string }
  job: { id: string; status: string; stage: string; rounds: number; pending: { code: string; message_pt: string }[] } | null
  draft: Draft | null
  versions: { id: string; version: number; status: string }[]
  messages: Msg[]
  awaiting_question: Msg | null
  photo_policy: { photoCount: number; missing: number; belowStandard: boolean; notes_pt: string[] } | null
}

const STAGES = [
  { stage: 'diagnosis', label: 'Analisando fotografias' },
  { stage: 'materials', label: 'Identificando materiais' },
  { stage: 'pricing', label: 'Pesquisando produtos' },
  { stage: 'labor', label: 'Calculando mão de obra' },
] as const

const card = { background: 'rgba(168,85,247,0.06)', border: '1px solid rgba(168,85,247,0.22)' }
const soft = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }
const gradient = { background: 'linear-gradient(135deg, #a855f7 0%, #4361ee 100%)', boxShadow: '0 4px 14px rgba(168,85,247,0.3)' }

const usd = (v: string | null | undefined) => (v ? `US$ ${v}` : null)
const toFile = (f: File): StoredFile => ({ blob: f, name: f.name, type: f.type })

async function api(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: Record<string, unknown> | null }> {
  try {
    const res = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } })
    return { ok: res.ok, status: res.status, data: (await res.json().catch(() => null)) as Record<string, unknown> | null }
  } catch {
    return { ok: false, status: 0, data: null }
  }
}

function useReplyDraft(appointmentId: string) {
  const key = `alizo_quote_reply_${appointmentId}`
  const [text, setText] = useState('')
  useEffect(() => {
    try {
      setText(localStorage.getItem(key) ?? '')
    } catch {}
  }, [key])
  const update = (value: string) => {
    setText(value)
    try {
      if (value) localStorage.setItem(key, value)
      else localStorage.removeItem(key)
    } catch {}
  }
  return [text, update] as const
}

export function QuoteAgentPanel({ unitId, appointmentId, savedStatus, hasUnsavedChanges, onPhotosChanged }: { unitId: string; appointmentId: string; savedStatus: string | null; hasUnsavedChanges: boolean; onPhotosChanged?: (photos: unknown) => void }) {
  const base = `/api/units/${unitId}/appointments/${appointmentId}/quote-agent`
  const [state, setState] = useState<AgentState | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const [offline, setOffline] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [mode, setMode] = useState<'view' | 'edit' | 'revise'>('view')

  const load = useCallback(async () => {
    const r = await api(base)
    if (r.status === 404 || r.status === 409) {
      setUnavailable(true)
      return
    }
    if (!r.ok || !r.data) {
      setOffline(true)
      return
    }
    setOffline(false)
    setState(r.data as unknown as AgentState)
  }, [base])

  useEffect(() => {
    void load()
  }, [load])

  // enquanto processa, acompanha a cada 4 s (o processamento é no servidor: fechar o app não interrompe)
  const processing = state?.job?.status === 'queued' || state?.job?.status === 'running'
  useEffect(() => {
    if (!processing) return
    const timer = setInterval(() => void load(), 4000)
    return () => clearInterval(timer)
  }, [processing, load])

  async function act(label: string, fn: () => Promise<{ ok: boolean; data: Record<string, unknown> | null; status: number }>) {
    setBusy(label)
    setError(null)
    setNotice(null)
    const r = await fn()
    setBusy(null)
    if (r.status === 0) {
      setError('Sem conexão agora. Nada foi perdido — tente de novo quando a internet voltar.')
      return null
    }
    if (!r.ok) {
      setError(String(r.data?.error ?? 'Não foi possível concluir.'))
      return null
    }
    if (r.data) setState(r.data as unknown as AgentState)
    return r
  }

  if (unavailable) return null
  if (!state) {
    return (
      <div className="rounded-2xl p-4 text-xs text-slate-400" style={card}>
        {offline ? 'Super Agente indisponível sem conexão.' : 'Carregando Super Agente…'}
      </div>
    )
  }

  const job = state.job
  const draft = state.draft
  const orderReady = savedStatus === 'quote' && !hasUnsavedChanges
  const canGenerate = !job || job.status === 'failed'
  const awaiting = job?.status === 'needs_input'
  const approved = draft?.draft.status === 'approved'

  return (
    <section className="flex flex-col gap-4 rounded-2xl p-4" style={card} aria-label="Super Agente de Cotações">
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-sm font-extrabold text-purple-200">
            <Sparkles size={16} /> Super Agente de Cotações
          </p>
          <p className="mt-1 text-xs text-slate-300">{state.status.label}</p>
        </div>
        <button type="button" onClick={() => void load()} className="rounded-lg p-2 text-slate-300" style={soft} aria-label="Atualizar">
          <RefreshCw size={14} />
        </button>
      </header>

      {offline && <p className="text-xs text-amber-300">Sem conexão: mostrando o último estado. O processamento continua no servidor.</p>}
      {error && <p className="rounded-xl px-3 py-2 text-xs font-semibold text-red-300" style={{ background: 'rgba(239,68,68,0.1)' }}>{error}</p>}
      {notice && <p className="rounded-xl px-3 py-2 text-xs font-semibold text-emerald-300" style={{ background: 'rgba(16,185,129,0.1)' }}>{notice}</p>}

      {canGenerate && (
        <div className="flex flex-col gap-3">
          {state.photo_policy?.notes_pt.map((n, i) => (
            <p key={i} className="text-xs text-amber-200">{n}</p>
          ))}
          {job?.status === 'failed' && <p className="text-xs text-amber-300">A análise anterior falhou, mas nada foi perdido. Toque para tentar de novo.</p>}
          {!orderReady && <p className="text-xs text-slate-300">{savedStatus !== 'quote' ? 'Salve a ordem como "Cotação" (botão no fim da tela) para liberar a análise.' : 'Salve as alterações da ordem antes de gerar a cotação.'}</p>}
          <p className="text-xs text-slate-400">O ideal são 5 fotos do defeito (visão geral, de perto, etiqueta/modelo, contexto e medida) e uma descrição curta. Se não conseguir tudo, pode gerar assim mesmo.</p>
          <button
            type="button"
            disabled={!orderReady || busy !== null}
            onClick={() => void act('generate', () => api(`${base}/generate`, { method: 'POST', body: '{}' }))}
            className="w-full rounded-xl px-4 py-4 text-base font-extrabold text-white transition-all active:scale-[0.98] disabled:opacity-40"
            style={gradient}
          >
            {busy === 'generate' ? 'Iniciando…' : job?.status === 'failed' ? 'Tentar de novo' : 'Gerar Cotação com IA'}
          </button>
        </div>
      )}

      {processing && <ProgressView stage={job?.stage ?? 'queued'} />}

      {awaiting && state.awaiting_question && <ReplyBox kind="answer" unitId={unitId} appointmentId={appointmentId} question={state.awaiting_question} busy={busy} onPhotos={onPhotosChanged} onSend={(skip) => act('reply', () => api(`${base}/messages`, { method: 'POST', body: JSON.stringify({ kind: 'answer', body: skip.text, skipQuestions: skip.skip }) }))} />}

      {job?.status === 'budget_exhausted' && <p className="rounded-xl px-3 py-2 text-xs text-amber-200" style={{ background: 'rgba(245,158,11,0.1)' }}>O orçamento de IA desta cotação acabou. Complete manualmente o que faltar abaixo — nada foi perdido.</p>}

      {draft && !processing && (
        <>
          <Report draft={draft} job={job} />
          {mode === 'edit' && !approved && <Editor draft={draft} busy={busy === 'save'} onCancel={() => setMode('view')} onSave={async (payload) => { const r = await act('save', () => api(`${base}/draft`, { method: 'PATCH', body: JSON.stringify(payload) })); if (r) { setMode('view'); setNotice('Alterações salvas.') } }} />}
          {mode === 'revise' && !approved && <ReplyBox kind="revision_request" unitId={unitId} appointmentId={appointmentId} question={null} busy={busy} onPhotos={onPhotosChanged} onSend={async (v) => { const r = await act('reply', () => api(`${base}/messages`, { method: 'POST', body: JSON.stringify({ kind: 'revision_request', body: v.text }) })); if (r) { setMode('view'); setNotice('Pedido enviado. A IA vai gerar uma nova versão.') } }} onCancel={() => setMode('view')} />}
          {mode === 'view' && (
            <div className="flex flex-col gap-2">
              {!approved && (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => setMode('edit')} className="flex items-center justify-center gap-2 rounded-xl px-3 py-3 text-sm font-bold text-slate-100" style={soft}><Pencil size={14} /> Editar cotação</button>
                    <button type="button" disabled={job?.status === 'budget_exhausted'} onClick={() => setMode('revise')} className="flex items-center justify-center gap-2 rounded-xl px-3 py-3 text-sm font-bold text-purple-100 disabled:opacity-40" style={{ background: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.4)' }}><Sparkles size={14} /> Solicitar revisão à IA</button>
                  </div>
                  <button
                    type="button"
                    disabled={busy !== null || draft.draft.technical_check === 'blocked'}
                    onClick={() => { if (window.confirm('Aprovar e salvar a cotação técnica?\n\nIsso aprova só a versão técnica: NÃO conclui o serviço e NADA é enviado ao cliente.')) void act('approve', () => api(`${base}/approve`, { method: 'POST', body: '{}' })).then((r) => r && setNotice('Cotação técnica aprovada e salva.')) }}
                    className="flex w-full items-center justify-center gap-2 rounded-xl px-4 py-4 text-base font-extrabold text-white disabled:opacity-40"
                    style={{ background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)' }}
                  >
                    <CheckCircle2 size={18} /> {busy === 'approve' ? 'Aprovando…' : 'Aprovar e salvar cotação'}
                  </button>
                  {draft.draft.technical_check === 'blocked' && <p className="text-xs text-amber-300">Há uma informação crítica faltando: corrija a cotação ou peça uma revisão antes de aprovar.</p>}
                </>
              )}
              <a href={`${base}/pdf`} className="flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold text-cyan-200" style={{ background: 'rgba(6,182,212,0.12)', border: '1px solid rgba(6,182,212,0.35)' }}>
                <FileDown size={15} /> Baixar PDF técnico{approved ? '' : ' (rascunho)'}
              </a>
            </div>
          )}
        </>
      )}

      {state.messages.length > 0 && <Conversation messages={state.messages} />}
    </section>
  )
}

function ProgressView({ stage }: { stage: string }) {
  const index = stage === 'queued' ? -1 : STAGES.findIndex((s) => s.stage === stage)
  const current = index === -1 && stage !== 'queued' ? STAGES.length - 1 : index
  return (
    <div className="flex flex-col gap-2 rounded-xl p-3" style={soft}>
      <p className="flex items-center gap-2 text-sm font-bold text-slate-100"><Loader2 size={14} className="animate-spin" /> {stage === 'queued' ? 'Preparando análise' : STAGES[Math.max(current, 0)]?.label}</p>
      <ol className="flex flex-col gap-1 text-xs text-slate-300">
        {STAGES.map((s, i) => (
          <li key={s.stage} className={i < current ? 'text-emerald-300' : i === current ? 'font-bold text-purple-200' : 'text-slate-500'}>{i < current ? '✓' : i === current ? '…' : '·'} {s.label}</li>
        ))}
      </ol>
      <p className="text-xs text-slate-400">Pode fechar o aplicativo: a análise continua no servidor e a cotação aparece aqui quando estiver pronta.</p>
    </div>
  )
}

function Badge({ children, tone = 'warn' }: { children: React.ReactNode; tone?: 'warn' | 'ok' | 'muted' }) {
  const color = tone === 'ok' ? '#6ee7b7' : tone === 'warn' ? '#fcd34d' : '#94a3b8'
  return <span className="rounded-md px-1.5 py-0.5 text-[10px] font-bold" style={{ color, background: 'rgba(255,255,255,0.06)', border: `1px solid ${color}55` }}>{children}</span>
}

function priceBadges(item: Item) {
  const out: React.ReactNode[] = []
  if (item.price_status === 'pending' && item.kind !== 'tool') out.push(<Badge key="p">Preço pendente</Badge>)
  if (item.price_status === 'verified') out.push(<Badge key="v" tone="ok">Preço verificado</Badge>)
  if (item.price_status === 'technician_corrected') out.push(<Badge key="t" tone="muted">Preço informado pelo técnico</Badge>)
  if (!item.brand && !item.model && !item.part_number && item.kind !== 'tool') out.push(<Badge key="n">Produto não confirmado</Badge>)
  if (item.needs_confirmation) out.push(<Badge key="c">Compatibilidade/dado a verificar</Badge>)
  return out
}

function Report({ draft, job }: { draft: Draft; job: AgentState['job'] }) {
  const d = draft.draft.diagnosis ?? null
  const items = draft.items
  const materials = items.filter((i) => i.kind !== 'tool')
  const tools = items.filter((i) => i.kind === 'tool')
  const labor = draft.labor
  const breakdown = (labor?.breakdown ?? []) as { phase: string; hours: number }[]
  const approved = draft.draft.status === 'approved'
  return (
    <div className="flex flex-col gap-4 rounded-xl p-3" style={soft}>
      <div className="flex items-center justify-between">
        <p className="text-sm font-extrabold text-slate-100">Cotação técnica — versão {draft.draft.version}</p>
        <Badge tone={approved ? 'ok' : 'warn'}>{approved ? 'Aprovada' : 'Aguardando revisão'}</Badge>
      </div>
      <Section title="1. Descrição do problema">
        <p className="text-sm text-slate-200">{d?.summary_pt ?? (draft.draft.tech_text_pt as string | null) ?? 'Sem descrição gerada.'}</p>
      </Section>
      <Section title="2. Diagnóstico provável e evidências">
        {d?.evidence.length ? <List title="Fatos confirmados pelas fotos" items={d.evidence.map((e) => `${e.fact} (foto ${e.photo_refs.map((n) => n + 1).join(', ')})`)} /> : <p className="text-xs text-slate-400">Nenhum fato visual confirmado.</p>}
        {d?.hypotheses.length ? <List title="Hipóteses (não confirmadas)" items={d.hypotheses.map((h) => `${h.text} — confiança ${h.confidence === 'high' ? 'alta' : h.confidence === 'medium' ? 'média' : 'baixa'}`)} tone="warn" /> : null}
        <List title="Ainda desconhecido" items={[...(d?.additional_info_needed.map((a) => a.request_pt) ?? []), ...(!d?.identified.brand && !d?.identified.model ? ['Marca/modelo não confirmados'] : [])]} tone="muted" />
      </Section>
      <Section title="3. Serviço recomendado"><p className="text-sm text-slate-200">{d?.scope_pt ?? '—'}</p></Section>
      {breakdown.length > 0 && <Section title="4. Etapas de execução"><ol className="list-decimal pl-5 text-sm text-slate-200">{breakdown.map((b, i) => <li key={i}>{b.phase} <span className="text-slate-400">({Number(b.hours)} h)</span></li>)}</ol></Section>}
      <Section title="5–9. Materiais (preço de compra, fornecedor e link)">
        {materials.length === 0 && <p className="text-xs text-slate-400">Nenhum material listado.</p>}
        {materials.map((m) => (
          <div key={m.id} className="rounded-lg p-2 text-sm" style={{ background: 'rgba(255,255,255,0.03)' }}>
            <p className="font-bold text-slate-100">{m.name_en} <span className="font-normal text-slate-400">× {String(m.quantity)} {m.unit}{m.necessity === 'conditional' ? ' (condicional)' : ''}</span></p>
            {m.brand || m.model || m.part_number ? <p className="text-xs text-slate-300">{[m.brand, m.model, m.part_number ? `P/N ${String(m.part_number)}` : null].filter(Boolean).map(String).join(' · ')}</p> : null}
            <p className="mt-1 text-xs text-slate-300">{usd(m.unit_price_usd) ? `${usd(m.unit_price_usd)} cada · subtotal ${usd(m.subtotal_usd)}` : 'Preço pendente'}{m.supplier ? ` · ${String(m.supplier)}` : ''}</p>
            {m.product_url ? <a href={String(m.product_url)} target="_blank" rel="noreferrer" className="break-all text-xs text-cyan-300 underline">{String(m.product_url)}</a> : null}
            {m.price_checked_at ? <p className="text-[11px] text-slate-500">Consulta: {new Date(String(m.price_checked_at)).toLocaleString('pt-BR')}</p> : null}
            {m.needs_confirmation ? <p className="mt-1 text-xs text-amber-200">A verificar: {String(m.needs_confirmation)}</p> : null}
            <div className="mt-1 flex flex-wrap gap-1">{priceBadges(m)}</div>
          </div>
        ))}
        <p className="text-sm font-bold text-slate-100">Total de materiais: {draft.totals.materials_usd ? `US$ ${draft.totals.materials_usd}` : 'pendente'}{draft.totals.partial ? ` (parcial — ${draft.totals.pending_price_count} sem preço)` : ''}</p>
      </Section>
      <Section title="10–12. Equipe e tempo">
        {labor ? <p className="text-sm text-slate-200">{String(labor.technicians)} técnico(s) · {String(labor.service_hours)} h de serviço · <b>{String(labor.man_hours)} horas-homem</b>{labor.justification_pt ? <><br /><span className="text-xs text-slate-400">{String(labor.justification_pt)}</span></> : null}{labor.multi_technician_justification ? <><br /><span className="text-xs text-amber-200">Por que mais de um técnico: {String(labor.multi_technician_justification)}</span></> : null}</p> : <p className="text-xs text-slate-400">Estimativa de mão de obra não gerada — preencha em "Editar cotação".</p>}
      </Section>
      {tools.length > 0 && <Section title="13. Ferramentas e equipamentos especiais"><List items={tools.map((t) => `${t.name_en}${Number(t.quantity) !== 1 ? ` × ${String(t.quantity)}` : ''}`)} /></Section>}
      <Section title="14. Alertas, riscos e informações pendentes">
        <List items={[...(d?.safety_risks.map((r) => `Segurança (${r.severity}): ${r.risk}`) ?? []), ...(draft.draft.warnings ?? []), ...(job?.pending.map((p) => p.message_pt) ?? [])].filter((v, i, a) => a.indexOf(v) === i)} tone="warn" />
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="flex flex-col gap-1.5"><p className="text-[11px] font-extrabold uppercase tracking-wide text-purple-300">{title}</p>{children}</div>
}

function List({ title, items, tone }: { title?: string; items: string[]; tone?: 'warn' | 'muted' }) {
  if (items.length === 0) return null
  return (
    <div>
      {title && <p className="text-xs font-bold text-slate-300">{title}</p>}
      <ul className={`list-disc pl-5 text-xs ${tone === 'warn' ? 'text-amber-200' : tone === 'muted' ? 'text-slate-400' : 'text-slate-200'}`}>{items.map((t, i) => <li key={i}>{t}</li>)}</ul>
    </div>
  )
}

function Conversation({ messages }: { messages: Msg[] }) {
  return (
    <details className="rounded-xl p-3" style={soft}>
      <summary className="cursor-pointer text-xs font-bold text-slate-300">Conversa com o agente ({messages.length})</summary>
      <ul className="mt-2 flex flex-col gap-2">
        {messages.map((m) => (
          <li key={m.id} className={`rounded-lg px-3 py-2 text-xs ${m.role === 'technician' ? 'self-end bg-cyan-500/10 text-cyan-100' : 'bg-white/5 text-slate-200'}`}>
            <b>{m.role === 'technician' ? 'Você' : m.role === 'agent' ? 'Agente' : m.role === 'admin' ? 'Administrador' : 'Sistema'}</b>
            {m.kind === 'revision_request' ? ' (pedido de revisão)' : ''}
            {m.body ? <p className="whitespace-pre-wrap">{m.body}</p> : null}
            {m.media.length > 0 && <p className="text-[11px] text-slate-400">{m.media.length} foto(s) anexada(s)</p>}
          </li>
        ))}
      </ul>
    </details>
  )
}

/** Resposta do técnico: texto + fotos (câmera ou galeria) na mesma mensagem. As fotos entram na WO pela fila offline (nunca se perdem). */
function ReplyBox({ kind, unitId, appointmentId, question, busy, onSend, onCancel, onPhotos }: { kind: 'answer' | 'revision_request'; unitId: string; appointmentId: string; question: Msg | null; busy: string | null; onSend: (v: { text: string; skip: boolean }) => Promise<unknown>; onCancel?: () => void; onPhotos?: (photos: unknown) => void }) {
  const [text, setText] = useReplyDraft(`${appointmentId}_${kind}`)
  const [files, setFiles] = useState<File[]>([])
  const [previews, setPreviews] = useState<string[]>([])
  const [localError, setLocalError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const camera = useRef<HTMLInputElement>(null)
  const gallery = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const urls = files.map((f) => URL.createObjectURL(f))
    setPreviews(urls)
    return () => urls.forEach((u) => URL.revokeObjectURL(u))
  }, [files])

  const add = (e: ChangeEvent<HTMLInputElement>) => {
    const next = Array.from(e.target.files ?? [])
    if (next.length) setFiles((p) => [...p, ...next])
    e.target.value = ''
  }

  async function send(skip: boolean) {
    setLocalError(null)
    if (!skip && !text.trim() && files.length === 0) {
      setLocalError('Escreva uma mensagem ou anexe uma foto.')
      return
    }
    if (files.length > 0) {
      setUploading(true)
      const result = await saveViaQueue({ id: localId(), unitId, appointmentId, fields: {}, files: { photosBefore: files.map(toFile) } })
      setUploading(false)
      if (result.kind === 'not_stored') {
        setLocalError('Não foi possível guardar as fotos no aparelho. Tente novamente.')
        return
      }
      if (result.kind === 'queued' || result.kind === 'failed') {
        // fotos ficam seguras no aparelho; o texto também (rascunho). O envio ao agente espera a conexão.
        setFiles([])
        setLocalError(result.kind === 'queued' ? `Fotos guardadas no aparelho (${result.label}). Quando enviarem, toque em enviar de novo — seu texto está guardado.` : `${result.message}`)
        return
      }
      if (result.patch?.service_order_photos) onPhotos?.(result.patch.service_order_photos)
      setFiles([])
    }
    await onSend({ text: text.trim(), skip })
    setText('')
  }

  const working = busy === 'reply' || uploading
  return (
    <div className="flex flex-col gap-3 rounded-xl p-3" style={{ background: 'rgba(6,182,212,0.07)', border: '1px solid rgba(6,182,212,0.3)' }}>
      {question ? (
        <div>
          <p className="flex items-center gap-2 text-sm font-extrabold text-cyan-100"><AlertTriangle size={14} /> O agente precisa de informações</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-slate-100">{question.body}</p>
        </div>
      ) : (
        <p className="text-sm font-extrabold text-cyan-100">O que a IA deve reavaliar?</p>
      )}
      {!question && <p className="text-xs text-slate-300">Ex.: "A peça está funcionando, o problema é só o alinhamento", "Considere reparar em vez de substituir", "São necessários dois técnicos porque a porta é pesada". Pode anexar fotos.</p>}
      <div className="flex flex-col gap-1">
        <Label>Sua resposta</Label>
        <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Escreva aqui (medidas, códigos gravados, ou que a etiqueta não existe…)" className="text-base" />
      </div>
      {previews.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {previews.map((src, i) => (
            <div key={i} className="relative h-16 w-16">
              <img src={src} alt="Foto a enviar" className="h-16 w-16 rounded-lg object-cover" />
              <button type="button" onClick={() => setFiles((p) => p.filter((_, j) => j !== i))} className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full text-white" style={{ background: '#ef4444' }} aria-label="Remover foto"><X size={12} /></button>
            </div>
          ))}
        </div>
      )}
      <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden" onChange={add} />
      <input ref={gallery} type="file" accept="image/*" multiple className="hidden" onChange={add} />
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => camera.current?.click()} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold text-cyan-200" style={{ background: 'rgba(6,182,212,0.15)', border: '1px solid rgba(6,182,212,0.4)' }}><Camera size={14} /> Tirar foto</button>
        <button type="button" onClick={() => gallery.current?.click()} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold text-slate-200" style={soft}><ImagePlus size={14} /> Da galeria</button>
      </div>
      {localError && <p className="text-xs font-semibold text-amber-300">{localError}</p>}
      <div className="flex flex-col gap-2">
        <button type="button" disabled={working} onClick={() => void send(false)} className="flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-extrabold text-white disabled:opacity-50" style={gradient}><Send size={15} /> {working ? 'Enviando…' : kind === 'answer' ? 'Enviar resposta' : 'Enviar pedido de revisão'}</button>
        {kind === 'answer' && <button type="button" disabled={working} onClick={() => void send(true)} className="w-full rounded-xl px-4 py-3 text-xs font-bold text-slate-300 disabled:opacity-50" style={soft}>Não tenho essa informação — continuar sem ela</button>}
        {onCancel && <button type="button" onClick={onCancel} className="text-xs font-bold text-slate-400">Cancelar</button>}
      </div>
    </div>
  )
}

type EditItem = { id: string; name_en: string; description_pt: string; quantity: string; unit: string; supplier: string; product_url: string; price: string }

/** Edição da cotação técnica (materiais, quantidades, preços de compra, fornecedores, horas). Só envia o que mudou. */
function Editor({ draft, busy, onSave, onCancel }: { draft: Draft; busy: boolean; onSave: (payload: Record<string, unknown>) => Promise<void>; onCancel: () => void }) {
  const original = draft.items
  const [items, setItems] = useState<EditItem[]>(() => original.map((i) => ({ id: i.id, name_en: i.name_en, description_pt: String(i.description_pt ?? ''), quantity: String(i.quantity), unit: i.unit, supplier: String(i.supplier ?? ''), product_url: String(i.product_url ?? ''), price: i.unit_price_usd ?? '' })))
  const [removed, setRemoved] = useState<string[]>([])
  const [added, setAdded] = useState<{ name_en: string; quantity: string; unit: string; price: string; supplier: string; product_url: string }[]>([])
  const labor = draft.labor
  const [technicians, setTechnicians] = useState(String(labor?.technicians ?? 1))
  const [hours, setHours] = useState(String(labor?.service_hours ?? ''))
  const [why, setWhy] = useState(String(labor?.multi_technician_justification ?? ''))
  const [err, setErr] = useState<string | null>(null)

  function save() {
    setErr(null)
    const payload: Record<string, unknown> = {}
    const changed: Record<string, unknown>[] = []
    for (const e of items) {
      const o = original.find((x) => x.id === e.id)
      if (!o || removed.includes(e.id)) continue
      const diff: Record<string, unknown> = { id: e.id }
      if (e.name_en.trim() !== o.name_en) diff.name_en = e.name_en.trim()
      if (e.description_pt !== String(o.description_pt ?? '')) diff.description_pt = e.description_pt
      if (Number(e.quantity) !== Number(o.quantity)) diff.quantity = Number(e.quantity)
      if (e.unit.trim() !== o.unit) diff.unit = e.unit.trim()
      if (e.supplier !== String(o.supplier ?? '')) diff.supplier = e.supplier.trim() || null
      if (e.product_url !== String(o.product_url ?? '')) diff.product_url = e.product_url.trim() || null
      if (e.price !== (o.unit_price_usd ?? '')) diff.unit_price_usd = e.price.trim() === '' ? null : Number(e.price.replace(',', '.'))
      if (Object.keys(diff).length > 1) changed.push(diff)
    }
    if (changed.length) payload.items = changed
    if (removed.length) payload.remove_item_ids = removed
    const add = added.filter((a) => a.name_en.trim()).map((a) => ({ name_en: a.name_en.trim(), quantity: Number(a.quantity) || 1, unit: a.unit.trim() || 'ea', unit_price_usd: a.price.trim() === '' ? null : Number(a.price.replace(',', '.')), supplier: a.supplier.trim() || null, product_url: a.product_url.trim() || null }))
    if (add.length) payload.add_items = add
    const t = Math.max(1, Math.round(Number(technicians) || 1))
    const h = Number(hours.replace(',', '.'))
    if (hours.trim() !== '' && (t !== Number(labor?.technicians ?? 1) || h !== Number(labor?.service_hours ?? NaN) || why !== String(labor?.multi_technician_justification ?? ''))) {
      if (t > 1 && !why.trim()) return setErr('Dois ou mais técnicos só com justificativa concreta (peso, tamanho, segurança…).')
      payload.labor = { technicians: t, service_hours: h, multi_technician_justification: t > 1 ? why.trim() : null }
    }
    if (Object.keys(payload).length === 0) return onCancel()
    void onSave(payload)
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl p-3" style={soft}>
      <p className="text-sm font-extrabold text-slate-100">Editar cotação</p>
      {items.filter((i) => !removed.includes(i.id)).map((it) => {
        const set = (patch: Partial<EditItem>) => setItems((p) => p.map((x) => (x.id === it.id ? { ...x, ...patch } : x)))
        return (
          <div key={it.id} className="flex flex-col gap-2 rounded-lg p-2" style={{ background: 'rgba(255,255,255,0.03)' }}>
            <Input value={it.name_en} onChange={(e) => set({ name_en: e.target.value })} placeholder="Nome do material" />
            <div className="grid grid-cols-3 gap-2">
              <Input inputMode="decimal" value={it.quantity} onChange={(e) => set({ quantity: e.target.value })} placeholder="Qtd" />
              <Input value={it.unit} onChange={(e) => set({ unit: e.target.value })} placeholder="Unid." />
              <Input inputMode="decimal" value={it.price} onChange={(e) => set({ price: e.target.value })} placeholder="Preço US$" />
            </div>
            <Input value={it.supplier} onChange={(e) => set({ supplier: e.target.value })} placeholder="Fornecedor" />
            <Input type="url" value={it.product_url} onChange={(e) => set({ product_url: e.target.value })} placeholder="Link do produto (https://…)" />
            <button type="button" onClick={() => setRemoved((p) => [...p, it.id])} className="self-end text-xs font-bold text-red-300">Remover item</button>
          </div>
        )
      })}
      {added.map((a, i) => {
        const set = (patch: Partial<(typeof added)[number]>) => setAdded((p) => p.map((x, j) => (j === i ? { ...x, ...patch } : x)))
        return (
          <div key={i} className="flex flex-col gap-2 rounded-lg p-2" style={{ background: 'rgba(16,185,129,0.06)' }}>
            <Input value={a.name_en} onChange={(e) => set({ name_en: e.target.value })} placeholder="Novo material" />
            <div className="grid grid-cols-3 gap-2">
              <Input inputMode="decimal" value={a.quantity} onChange={(e) => set({ quantity: e.target.value })} placeholder="Qtd" />
              <Input value={a.unit} onChange={(e) => set({ unit: e.target.value })} placeholder="Unid." />
              <Input inputMode="decimal" value={a.price} onChange={(e) => set({ price: e.target.value })} placeholder="Preço US$" />
            </div>
            <Input value={a.supplier} onChange={(e) => set({ supplier: e.target.value })} placeholder="Fornecedor" />
            <Input type="url" value={a.product_url} onChange={(e) => set({ product_url: e.target.value })} placeholder="Link (https://…)" />
          </div>
        )
      })}
      <button type="button" onClick={() => setAdded((p) => [...p, { name_en: '', quantity: '1', unit: 'ea', price: '', supplier: '', product_url: '' }])} className="self-start rounded-lg px-3 py-2 text-xs font-bold text-emerald-200" style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.35)' }}>+ Adicionar material</button>
      <div className="flex flex-col gap-2 rounded-lg p-2" style={{ background: 'rgba(255,255,255,0.03)' }}>
        <p className="text-xs font-bold text-slate-300">Equipe e tempo</p>
        <div className="grid grid-cols-2 gap-2">
          <div><Label>Técnicos</Label><Input inputMode="numeric" value={technicians} onChange={(e) => setTechnicians(e.target.value)} /></div>
          <div><Label>Horas de serviço</Label><Input inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} /></div>
        </div>
        {Number(technicians) > 1 && <Textarea rows={2} value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Por que mais de um técnico? (ex.: porta muito pesada)" />}
        <p className="text-xs text-slate-400">Horas-homem = técnicos × horas: {((Math.max(1, Math.round(Number(technicians) || 1))) * (Number(hours.replace(',', '.')) || 0)).toFixed(2)} h</p>
      </div>
      {err && <p className="text-xs font-semibold text-amber-300">{err}</p>}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={onCancel} className="rounded-xl px-3 py-3 text-sm font-bold text-slate-200" style={soft}>Cancelar</button>
        <button type="button" disabled={busy} onClick={save} className="rounded-xl px-3 py-3 text-sm font-extrabold text-white disabled:opacity-50" style={gradient}>{busy ? 'Salvando…' : 'Salvar alterações'}</button>
      </div>
    </div>
  )
}
