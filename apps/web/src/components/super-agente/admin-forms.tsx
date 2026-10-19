'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Input, Label, Textarea } from '@/components/ui/dashboard-ui'

const btn = 'rounded-xl px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50'
const grad = { background: 'linear-gradient(135deg, #a855f7 0%, #4361ee 100%)' }

async function send(path: string, method: string, body: unknown) {
  try {
    const res = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null
    return { ok: res.ok, data }
  } catch {
    return { ok: false, data: { error: 'Sem conexão.' } as Record<string, unknown> }
  }
}

/** Liga/desliga o piloto (imediato, sem tocar na operação normal) e escolhe os técnicos autorizados. */
export function PilotControls({ unitId, mode, employees }: { unitId: string; mode: string; employees: { id: string; name: string; enabled: boolean }[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [emps, setEmps] = useState(employees)
  const base = `/api/units/${unitId}/quote-agent-admin/settings`

  async function setMode(next: 'off' | 'shadow' | 'live') {
    if (next === 'off' && !window.confirm('Desligar o Super Agente agora? A operação normal (ordens, fotos, PDFs) não é afetada. Nada é apagado.')) return
    if (next === 'live' && !window.confirm('Ativar o Super Agente para os técnicos autorizados desta unidade?')) return
    setBusy(true)
    setError(null)
    const r = await send(base, 'PATCH', { mode: next })
    setBusy(false)
    if (!r.ok) return setError(String(r.data?.error ?? 'Não foi possível alterar.'))
    router.refresh()
  }
  async function toggle(id: string, enabled: boolean) {
    setEmps((p) => p.map((e) => (e.id === id ? { ...e, enabled } : e)))
    const r = await send(base, 'PATCH', { employees: [{ id, enabled }] })
    if (!r.ok) {
      setError(String(r.data?.error ?? 'Não foi possível salvar.'))
      setEmps((p) => p.map((e) => (e.id === id ? { ...e, enabled: !enabled } : e)))
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-slate-300">Estado do agente nesta unidade:</span>
        <b className={mode === 'live' ? 'text-emerald-300' : mode === 'shadow' ? 'text-amber-300' : 'text-slate-400'}>{mode === 'live' ? 'ATIVO (técnicos autorizados)' : mode === 'shadow' ? 'MODO SOMBRA (só administrador)' : 'DESLIGADO'}</b>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy || mode === 'live'} onClick={() => setMode('live')} className={btn} style={grad}>Ativar piloto</button>
        <button type="button" disabled={busy || mode === 'shadow'} onClick={() => setMode('shadow')} className={btn} style={{ background: '#475569' }}>Modo sombra</button>
        <button type="button" disabled={busy || mode === 'off'} onClick={() => setMode('off')} className={btn} style={{ background: '#dc2626' }}>Desligar agora</button>
      </div>
      <div>
        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">Técnicos autorizados no piloto</p>
        {emps.length === 0 && <p className="text-xs text-slate-500">Nenhum profissional cadastrado nesta unidade.</p>}
        {emps.map((e) => (
          <label key={e.id} className="flex items-center gap-2 py-1 text-sm text-slate-200">
            <input type="checkbox" checked={e.enabled} onChange={(ev) => toggle(e.id, ev.target.checked)} /> {e.name}
          </label>
        ))}
      </div>
      {error && <p className="text-xs font-semibold text-red-300">{error}</p>}
    </div>
  )
}

type Rate = { billed_hourly_rate?: number | null; technician_hourly_pay?: number | null; min_billable_hours?: number | null; travel_fee_flat?: number | null; travel_fee_hourly?: number | null; materials_markup_pct?: number | null; tax_rules?: { pct?: number } | null; rounding_rule?: string | null }

/** Regra comercial da unidade (SOMENTE ADMIN). Campo vazio = regra inexistente: nada é aplicado automaticamente. */
export function RateCardForm({ unitId, initial }: { unitId: string; initial: Rate | null }) {
  const router = useRouter()
  const s = (v: number | null | undefined) => (v == null ? '' : String(v))
  const [f, setF] = useState({ billed: s(initial?.billed_hourly_rate), pay: s(initial?.technician_hourly_pay), min: s(initial?.min_billable_hours), travelFlat: s(initial?.travel_fee_flat), travelHourly: s(initial?.travel_fee_hourly), markup: s(initial?.materials_markup_pct), tax: s(initial?.tax_rules?.pct), rounding: initial?.rounding_rule ?? '' })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const n = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')))
  async function save() {
    setBusy(true)
    setMsg(null)
    const r = await send(`/api/units/${unitId}/quote-agent-admin/rate-card`, 'PUT', { billed_hourly_rate: n(f.billed), technician_hourly_pay: n(f.pay), min_billable_hours: n(f.min), travel_fee_flat: n(f.travelFlat), travel_fee_hourly: n(f.travelHourly), materials_markup_pct: n(f.markup), tax_pct: n(f.tax), rounding_rule: f.rounding || null })
    setBusy(false)
    setMsg(r.ok ? { ok: true, text: 'Regra salva (nova vigência). Valem para as próximas análises e edições.' } : { ok: false, text: String(r.data?.error ?? 'Não foi possível salvar.') })
    if (r.ok) router.refresh()
  }
  const field = (label: string, key: keyof typeof f, hint?: string) => (
    <div key={key}><Label>{label}</Label><Input inputMode="decimal" value={f[key]} onChange={(e) => setF((p) => ({ ...p, [key]: e.target.value }))} placeholder={hint ?? 'vazio = não se aplica'} /></div>
  )
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-amber-200">Visível só para administradores. O técnico nunca vê estes valores (nem por API). Campos vazios = regra inexistente.</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {field('Valor/hora-homem cobrado (US$)', 'billed')}
        {field('Valor/hora-homem pago ao técnico (US$)', 'pay')}
        {field('Hora mínima cobrável (h)', 'min')}
        {field('Deslocamento fixo (US$)', 'travelFlat')}
        {field('Deslocamento por hora (US$)', 'travelHourly')}
        {field('Markup sobre materiais (%)', 'markup')}
        {field('Imposto percentual (%)', 'tax')}
        <div><Label>Arredondamento</Label><select value={f.rounding} onChange={(e) => setF((p) => ({ ...p, rounding: e.target.value }))} className="w-full rounded-xl bg-[#0d1220] px-3 py-2.5 text-sm text-white"><option value="">Sem arredondamento</option><option value="cent_half_up">Centavo (meio para cima)</option><option value="cent_up">Centavo (para cima)</option><option value="cent_down">Centavo (para baixo)</option><option value="dollar_half_up">Dólar (meio para cima)</option></select></div>
      </div>
      <button type="button" disabled={busy} onClick={save} className={btn} style={grad}>{busy ? 'Salvando…' : 'Salvar regra comercial'}</button>
      {msg && <p className={`text-xs font-semibold ${msg.ok ? 'text-emerald-300' : 'text-red-300'}`}>{msg.text}</p>}
    </div>
  )
}

type Review = { diagnosis_verdict?: string | null; diagnosis_confirmed_pt?: string | null; materials_correct?: number; materials_incorrect?: number; hours_suggested?: number | null; hours_final?: number | null; manual_interventions?: number; notes?: string | null }

/** Avaliação humana da cotação no piloto. */
export function ReviewForm({ unitId, appointmentId, initial, suggestedHours }: { unitId: string; appointmentId: string; initial: Review | null; suggestedHours: number | null }) {
  const router = useRouter()
  const [f, setF] = useState({ verdict: initial?.diagnosis_verdict ?? '', confirmed: initial?.diagnosis_confirmed_pt ?? '', ok: String(initial?.materials_correct ?? 0), bad: String(initial?.materials_incorrect ?? 0), hs: initial?.hours_suggested != null ? String(initial.hours_suggested) : suggestedHours != null ? String(suggestedHours) : '', hf: initial?.hours_final != null ? String(initial.hours_final) : '', manual: String(initial?.manual_interventions ?? 0), notes: initial?.notes ?? '' })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const num = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')))
  async function save() {
    setBusy(true)
    const r = await send(`/api/units/${unitId}/quote-agent-admin/review`, 'PUT', { appointmentId, diagnosis_verdict: f.verdict || null, diagnosis_confirmed_pt: f.confirmed || null, materials_correct: Number(f.ok) || 0, materials_incorrect: Number(f.bad) || 0, hours_suggested: num(f.hs), hours_final: num(f.hf), manual_interventions: Number(f.manual) || 0, notes: f.notes || null })
    setBusy(false)
    setMsg(r.ok ? { ok: true, text: 'Avaliação salva.' } : { ok: false, text: String(r.data?.error ?? 'Não foi possível salvar.') })
    if (r.ok) router.refresh()
  }
  return (
    <div className="flex flex-col gap-3">
      <div><Label>Diagnóstico da IA foi…</Label><select value={f.verdict} onChange={(e) => setF((p) => ({ ...p, verdict: e.target.value }))} className="w-full rounded-xl bg-[#0d1220] px-3 py-2.5 text-sm text-white"><option value="">— avaliar —</option><option value="correct">Correto</option><option value="partial">Parcial</option><option value="incorrect">Incorreto</option></select></div>
      <div><Label>Diagnóstico confirmado pelo técnico</Label><Textarea rows={2} value={f.confirmed} onChange={(e) => setF((p) => ({ ...p, confirmed: e.target.value }))} /></div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div><Label>Materiais corretos</Label><Input inputMode="numeric" value={f.ok} onChange={(e) => setF((p) => ({ ...p, ok: e.target.value }))} /></div>
        <div><Label>Materiais incorretos</Label><Input inputMode="numeric" value={f.bad} onChange={(e) => setF((p) => ({ ...p, bad: e.target.value }))} /></div>
        <div><Label>Horas sugeridas</Label><Input inputMode="decimal" value={f.hs} onChange={(e) => setF((p) => ({ ...p, hs: e.target.value }))} /></div>
        <div><Label>Horas ajustadas</Label><Input inputMode="decimal" value={f.hf} onChange={(e) => setF((p) => ({ ...p, hf: e.target.value }))} /></div>
      </div>
      <div><Label>Intervenções manuais necessárias</Label><Input inputMode="numeric" value={f.manual} onChange={(e) => setF((p) => ({ ...p, manual: e.target.value }))} /></div>
      <div><Label>Observações / falhas</Label><Textarea rows={3} value={f.notes} onChange={(e) => setF((p) => ({ ...p, notes: e.target.value }))} /></div>
      <button type="button" disabled={busy} onClick={save} className={btn} style={grad}>{busy ? 'Salvando…' : 'Salvar avaliação'}</button>
      {msg && <p className={`text-xs font-semibold ${msg.ok ? 'text-emerald-300' : 'text-red-300'}`}>{msg.text}</p>}
    </div>
  )
}

/** O administrador pede uma correção/revisão: a IA reanalisa e gera uma nova versão (mesmo teto de orçamento da cotação). */
export function AdminRevisionForm({ unitId, appointmentId, disabled }: { unitId: string; appointmentId: string; disabled: boolean }) {
  const router = useRouter()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  async function submit() {
    if (!text.trim()) return
    setBusy(true)
    const r = await send(`/api/units/${unitId}/appointments/${appointmentId}/quote-agent/messages`, 'POST', { kind: 'revision_request', body: text })
    setBusy(false)
    setMsg(r.ok ? { ok: true, text: 'Pedido enviado: a IA vai gerar uma nova versão.' } : { ok: false, text: String(r.data?.error ?? 'Não foi possível enviar.') })
    if (r.ok) {
      setText('')
      router.refresh()
    }
  }
  return (
    <div className="flex flex-col gap-2">
      <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder='Ex.: "Considere reparar em vez de substituir" ou "São necessários dois técnicos".' />
      <button type="button" disabled={busy || disabled || !text.trim()} onClick={submit} className={btn} style={grad}>{busy ? 'Enviando…' : 'Solicitar correção à IA'}</button>
      {msg && <p className={`text-xs font-semibold ${msg.ok ? 'text-emerald-300' : 'text-red-300'}`}>{msg.text}</p>}
    </div>
  )
}
