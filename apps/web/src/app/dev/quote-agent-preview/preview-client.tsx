'use client'

import { useEffect, useRef, useState } from 'react'
import { QuoteAgentPanel } from '@/components/portal-funcionario/quote-agent-panel'

type Json = Record<string, unknown>
const U = 'unit-1'
const A = 'appt-1'

const diagnosis = {
  summary_pt: 'A porta comercial de vidro não fecha por completo; a mola aérea parece desregulada ou desgastada.',
  problem_en: 'The storefront glass door does not latch closed.',
  evidence: [{ fact: 'The overhead door closer arm is visible above the door frame.', photo_refs: [0, 1], confidence: 'high' }, { fact: 'The strike plate shows no visible misalignment.', photo_refs: [2], confidence: 'medium' }],
  hypotheses: [{ text: 'The closer speed/latch valve needs adjustment.', confidence: 'medium' }, { text: 'The internal spring may be worn.', confidence: 'low' }],
  identified: { brand: null, model: null, part_numbers: [], labels_read: [] },
  additional_info_needed: [{ kind: 'label', request_pt: 'Foto da etiqueta do fabricante da mola aérea' }],
  safety_risks: [{ risk: 'Trabalho em escada acima de 1,8 m', severity: 'medium' }],
  scope_pt: 'Ajustar a velocidade de fechamento e a trava; se a mola estiver gasta, substituir a mola aérea.',
  visual_confidence: 'medium',
}
const items = (priced: boolean) => [
  { id: 'i1', position: 0, kind: 'material', necessity: 'required', name_en: 'Door closer (overhead, commercial)', description_pt: 'Mola aérea comercial', quantity: 1, unit: 'ea', brand: null, model: null, part_number: null, needs_confirmation: 'Compatibilidade a verificar: comprimento do braço', price_status: priced ? 'technician_corrected' : 'pending', unit_price_usd: priced ? '89.97' : null, subtotal_usd: priced ? '89.97' : null, supplier: priced ? 'Home Depot' : null, product_url: priced ? 'https://www.homedepot.com/p/closer/123' : null, price_checked_at: priced ? '2026-10-20T15:00:00Z' : null },
  { id: 'i2', position: 1, kind: 'consumable', necessity: 'conditional', name_en: 'Mounting screws (#12 x 1")', description_pt: 'Parafusos de fixação', quantity: 6, unit: 'ea', brand: null, model: null, part_number: null, needs_confirmation: null, price_status: 'pending', unit_price_usd: null, subtotal_usd: null, supplier: null, product_url: null },
  { id: 'i3', position: 2, kind: 'tool', necessity: 'required', name_en: 'Hex key set', description_pt: 'Jogo de chaves hexagonais', quantity: 1, unit: 'ea', price_status: 'pending', unit_price_usd: null, subtotal_usd: null },
]
const labor = { technicians: 1, service_hours: 1.5, man_hours: 1.5, justification_pt: 'Ajuste simples na mola; uma pessoa consegue fazer com segurança.', multi_technician_justification: null, breakdown: [{ phase: 'Adjust closer speed and latch', hours: 1 }, { phase: 'Test door operation', hours: 0.5 }] }

function buildState(kind: 'idle' | 'processing' | 'question' | 'report' | 'approved', stage = 'diagnosis'): Json {
  const draft = kind === 'report' || kind === 'approved' ? { draft: { id: 'd1', status: kind === 'approved' ? 'approved' : 'draft', version: 1, technical_check: 'needs_confirmation', warnings: ['Marca/modelo da mola não confirmados'], diagnosis }, items: items(kind === 'approved'), options: [], labor, media: [], totals: { materials_usd: kind === 'approved' ? '89.97' : null, pending_price_count: kind === 'approved' ? 1 : 2, partial: true } } : null
  const labels: Record<string, string> = { idle: 'Pronta para gerar a cotação com IA', processing: 'Analisando fotografias', question: 'Aguardando informações', report: 'Aguardando revisão do técnico', approved: 'Cotação técnica aprovada' }
  const question = { id: 'm1', role: 'agent', kind: 'question', body: 'Preciso de algumas informações para continuar:\n• Foto da etiqueta do fabricante da mola aérea\n• Largura aproximada da porta', media: [], questions: [], created_at: '2026-10-20T15:00:00Z' }
  return {
    actor: 'technician',
    status: { code: kind, label: labels[kind] },
    job: kind === 'idle' ? null : { id: 'j1', status: kind === 'processing' ? 'running' : kind === 'question' ? 'needs_input' : 'completed', stage: kind === 'processing' ? stage : 'done', rounds: 1, pending: kind === 'report' ? [{ code: 'prices_manual', message_pt: 'Preços pendentes: preencha preço, fornecedor e link de cada material manualmente.' }] : [] },
    draft,
    versions: draft ? [{ id: 'd1', version: 1, status: kind === 'approved' ? 'approved' : 'draft' }] : [],
    messages: kind === 'question' ? [question] : [],
    awaiting_question: kind === 'question' ? question : null,
    photo_policy: { photoCount: 3, missing: 2, belowStandard: true, notes_pt: ['Faltam 2 foto(s) para o padrão de 5: visão geral, problema de perto, etiqueta/modelo, contexto/acesso e medida/escala — ou informe o motivo.'] },
  }
}

export function PreviewClient() {
  const [scenario, setScenario] = useState<'idle' | 'processing' | 'question' | 'report' | 'approved'>('idle')
  const [ready, setReady] = useState(false)
  const state = useRef<Json>(buildState('idle'))
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const original = useRef<typeof fetch | null>(null)
  const [key, setKey] = useState(0)

  useEffect(() => {
    original.current = window.fetch
    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (!url.includes('/quote-agent')) return original.current!(input, init)
      const method = (init?.method ?? 'GET').toUpperCase()
      const respond = (body: Json, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
      const run = (steps: [number, () => void][]) => steps.forEach(([ms, fn]) => timers.current.push(setTimeout(fn, ms)))
      if (url.endsWith('/generate')) {
        state.current = buildState('processing', 'diagnosis')
        run([[1500, () => (state.current = buildState('processing', 'materials'))], [3000, () => (state.current = buildState('processing', 'pricing'))], [4500, () => (state.current = buildState('processing', 'labor'))], [6000, () => (state.current = buildState('report'))]])
        return respond({ ...state.current, start: 'started' }, 202)
      }
      if (url.endsWith('/messages')) {
        state.current = buildState('processing', 'diagnosis')
        run([[2500, () => (state.current = buildState('report'))]])
        return respond(state.current, 202)
      }
      if (url.endsWith('/draft') && method === 'PATCH') {
        const body = JSON.parse(String(init?.body ?? '{}')) as { items?: { id: string; unit_price_usd?: number | null; supplier?: string }[] }
        const s = buildState('report') as { draft: { items: Record<string, unknown>[]; totals: Record<string, unknown> } }
        for (const e of body.items ?? []) {
          const it = s.draft.items.find((x) => x.id === e.id)
          if (it && e.unit_price_usd != null) Object.assign(it, { unit_price_usd: e.unit_price_usd.toFixed(2), subtotal_usd: (e.unit_price_usd * Number(it.quantity)).toFixed(2), price_status: 'technician_corrected', supplier: e.supplier ?? it.supplier })
        }
        state.current = s as unknown as Json
        return respond(state.current)
      }
      if (url.endsWith('/approve')) {
        state.current = buildState('approved')
        return respond(state.current)
      }
      return respond(state.current)
    }) as typeof fetch
    setReady(true)
    return () => {
      if (original.current) window.fetch = original.current
      timers.current.forEach(clearTimeout)
    }
  }, [])

  function pick(next: typeof scenario) {
    timers.current.forEach(clearTimeout)
    state.current = buildState(next)
    setScenario(next)
    setKey((k) => k + 1)
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 p-4" style={{ background: '#0a0f1e', minHeight: '100vh', color: '#e2e8f0' }}>
      <p className="text-xs text-slate-400">Pré-visualização (dados simulados). Cenário:</p>
      <div className="flex flex-wrap gap-2">
        {(['idle', 'processing', 'question', 'report', 'approved'] as const).map((s) => (
          <button key={s} type="button" onClick={() => pick(s)} className="rounded-lg px-3 py-1 text-xs font-bold" style={{ background: scenario === s ? '#a855f7' : '#1e293b', color: '#fff' }}>{s}</button>
        ))}
      </div>
      {ready && <QuoteAgentPanel key={key} unitId={U} appointmentId={A} savedStatus="quote" hasUnsavedChanges={false} />}
    </div>
  )
}
