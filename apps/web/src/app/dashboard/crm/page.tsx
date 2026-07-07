'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Lead, LeadStatus } from '@/lib/types'

// ── Column definitions ────────────────────────────────────────────────────────
const COLUMNS: {
  status: LeadStatus
  label: string
  accent: string        // gradient top bar
  bg: string            // column bg
  badge: string         // count badge
  dot: string           // card dot
}[] = [
  {
    status: 'new',
    label: 'Novo',
    accent: 'linear-gradient(90deg,#64748b,#94a3b8)',
    bg: 'rgba(241,245,249,0.7)',
    badge: 'bg-slate-200 text-slate-700',
    dot: 'bg-slate-400',
  },
  {
    status: 'contacted',
    label: 'Em Contato',
    accent: 'linear-gradient(90deg,#2563eb,#3b82f6)',
    bg: 'rgba(239,246,255,0.7)',
    badge: 'bg-blue-100 text-blue-700',
    dot: 'bg-blue-400',
  },
  {
    status: 'replied',
    label: 'Respondeu',
    accent: 'linear-gradient(90deg,#d97706,#f59e0b)',
    bg: 'rgba(255,251,235,0.7)',
    badge: 'bg-amber-100 text-amber-700',
    dot: 'bg-amber-400',
  },
  {
    status: 'negotiating',
    label: 'Negociando',
    accent: 'linear-gradient(90deg,#7c3aed,#a78bfa)',
    bg: 'rgba(245,243,255,0.7)',
    badge: 'bg-violet-100 text-violet-700',
    dot: 'bg-violet-400',
  },
  {
    status: 'won',
    label: 'Convertido',
    accent: 'linear-gradient(90deg,#16a34a,#22c55e)',
    bg: 'rgba(240,253,244,0.7)',
    badge: 'bg-green-100 text-green-700',
    dot: 'bg-green-400',
  },
  {
    status: 'lost',
    label: 'Perdido',
    accent: 'linear-gradient(90deg,#dc2626,#f87171)',
    bg: 'rgba(255,241,242,0.7)',
    badge: 'bg-red-100 text-red-700',
    dot: 'bg-red-400',
  },
]

const PIPELINE_ORDER: LeadStatus[] = ['new', 'contacted', 'replied', 'negotiating', 'won', 'lost']

const SOURCE_LABEL: Record<string, string> = {
  whatsapp: '📱 WhatsApp',
  instagram: '📸 Instagram',
  indicacao: '🤝 Indicação',
  site: '🌐 Site',
  linkedin: '💼 LinkedIn',
  manual: '✍️ Manual',
}

function daysSince(dateStr: string | null): number {
  if (!dateStr) return 0
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000)
}

// ── Add Lead modal ─────────────────────────────────────────────────────────────
type NewLeadForm = {
  company_name: string
  contact_name: string
  phone: string
  email: string
  source: string
  unit_id: string
  notes: string
}

const EMPTY_FORM: NewLeadForm = {
  company_name: '',
  contact_name: '',
  phone: '',
  email: '',
  source: 'manual',
  unit_id: '',
  notes: '',
}

function AddLeadModal({
  units,
  onClose,
  onSave,
}: {
  units: { id: string; name: string }[]
  onClose: () => void
  onSave: (lead: Lead) => void
}) {
  const [form, setForm] = useState<NewLeadForm>({ ...EMPTY_FORM, unit_id: units[0]?.id ?? '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function set(key: keyof NewLeadForm, val: string) {
    setForm((p) => ({ ...p, [key]: val }))
  }

  async function handleSave() {
    if (!form.company_name.trim()) { setError('Nome da empresa é obrigatório'); return }
    if (!form.unit_id) { setError('Selecione uma unidade'); return }
    setSaving(true)
    const supabase = createClient()
    const { data, error: err } = await supabase
      .from('leads')
      .insert({
        company_name: form.company_name.trim(),
        contact_name: form.contact_name.trim() || null,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        source: form.source,
        unit_id: form.unit_id,
        notes: form.notes.trim() || null,
        status: 'new',
        sector: null,
        city: null,
        state: null,
        google_place_id: null,
        last_contacted_at: null,
      })
      .select()
      .single()
    setSaving(false)
    if (err) { setError(err.message); return }
    onSave(data as Lead)
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <p className="text-sm font-bold text-slate-900">Novo Lead</p>
            <p className="text-xs text-slate-500">Adicionar manualmente ao pipeline</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-3">
          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="mb-1 block text-xs font-medium text-slate-600">Empresa *</label>
              <input
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none focus:border-green-400 focus:ring-1 focus:ring-green-100"
                placeholder="Ex: Imobiliária Silva"
                value={form.company_name}
                onChange={(e) => set('company_name', e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Contato</label>
              <input
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none focus:border-green-400 focus:ring-1 focus:ring-green-100"
                placeholder="Nome"
                value={form.contact_name}
                onChange={(e) => set('contact_name', e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">WhatsApp</label>
              <input
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none focus:border-green-400 focus:ring-1 focus:ring-green-100"
                placeholder="+55 11 9..."
                value={form.phone}
                onChange={(e) => set('phone', e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Origem</label>
              <select
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none focus:border-green-400"
                value={form.source}
                onChange={(e) => set('source', e.target.value)}
              >
                {Object.entries(SOURCE_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>{v.replace(/^.{2}/, '').trim()}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Unidade *</label>
              <select
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none focus:border-green-400"
                value={form.unit_id}
                onChange={(e) => set('unit_id', e.target.value)}
              >
                {units.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </div>
            <div className="col-span-2">
              <label className="mb-1 block text-xs font-medium text-slate-600">Observações</label>
              <textarea
                rows={2}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none focus:border-green-400 focus:ring-1 focus:ring-green-100 resize-none"
                placeholder="Contexto, interesse, etc."
                value={form.notes}
                onChange={(e) => set('notes', e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <button
            onClick={onClose}
            className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg,#22c55e,#16a34a)', boxShadow: '0 2px 8px rgba(34,197,94,0.25)' }}
          >
            {saving ? 'Salvando...' : 'Adicionar Lead'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Detail Panel ───────────────────────────────────────────────────────────────
function LeadDetail({
  lead,
  onClose,
  onUpdate,
}: {
  lead: Lead
  onClose: () => void
  onUpdate: (updated: Lead) => void
}) {
  const [notes, setNotes] = useState(lead.notes ?? '')
  const [saving, setSaving] = useState(false)

  async function saveNotes() {
    setSaving(true)
    const supabase = createClient()
    const { data } = await supabase
      .from('leads')
      .update({ notes, updated_at: new Date().toISOString() })
      .eq('id', lead.id)
      .select()
      .single()
    setSaving(false)
    if (data) onUpdate(data as Lead)
  }

  const col = COLUMNS.find((c) => c.status === lead.status) ?? COLUMNS[0]!

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      style={{ background: 'rgba(0,0,0,0.25)' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="flex h-full w-full max-w-sm flex-col bg-white shadow-2xl">
        {/* Top accent */}
        <div className="h-[3px]" style={{ background: col.accent }} />

        {/* Header */}
        <div className="flex items-start justify-between px-5 pt-4 pb-3 border-b border-slate-100">
          <div>
            <p className="text-base font-black text-slate-900">{lead.company_name}</p>
            {lead.contact_name && <p className="text-sm text-slate-500">{lead.contact_name}</p>}
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        {/* Info rows */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Status', val: col.label },
              { label: 'Origem', val: SOURCE_LABEL[lead.source] ?? lead.source },
              { label: 'Telefone', val: lead.phone ?? '—' },
              { label: 'Email', val: lead.email ?? '—' },
              { label: 'Cidade', val: lead.city ? `${lead.city}${lead.state ? ', ' + lead.state : ''}` : '—' },
              { label: 'Dias no funil', val: `${daysSince(lead.created_at)}d` },
              { label: 'Último contato', val: lead.last_contacted_at ? new Date(lead.last_contacted_at).toLocaleDateString('pt-BR') : '—' },
              { label: 'Criado em', val: new Date(lead.created_at).toLocaleDateString('pt-BR') },
            ].map(({ label, val }) => (
              <div key={label} className="rounded-xl bg-slate-50 px-3 py-2.5">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{label}</p>
                <p className="mt-0.5 text-sm font-medium text-slate-800 truncate">{val}</p>
              </div>
            ))}
          </div>

          {/* Notes */}
          <div>
            <label className="mb-1.5 block text-xs font-bold uppercase tracking-widest text-slate-400">Observações</label>
            <textarea
              rows={5}
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-green-400 focus:ring-1 focus:ring-green-100 resize-none"
              placeholder="Histórico, interesse, objeções..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
            <button
              onClick={saveNotes}
              disabled={saving || notes === (lead.notes ?? '')}
              className="mt-2 w-full rounded-xl py-2 text-sm font-semibold text-white disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg,#22c55e,#16a34a)' }}
            >
              {saving ? 'Salvando...' : 'Salvar observações'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Lead Card ──────────────────────────────────────────────────────────────────
function LeadCard({
  lead,
  col,
  onMove,
  onClick,
}: {
  lead: Lead
  col: (typeof COLUMNS)[number]
  onMove: (id: string, status: LeadStatus) => void
  onClick: () => void
}) {
  const days = daysSince(lead.last_contacted_at ?? lead.created_at)
  const colIdx = PIPELINE_ORDER.indexOf(lead.status)
  const canBack = colIdx > 0 && lead.status !== 'lost'
  const canFwd  = colIdx < PIPELINE_ORDER.length - 1

  const daysColor =
    days > 7 ? 'text-red-500' : days > 3 ? 'text-amber-500' : 'text-slate-400'

  return (
    <div
      className="rounded-2xl bg-white cursor-pointer group"
      style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 0 0 1px rgba(226,232,240,0.8)' }}
    >
      {/* Top accent */}
      <div className="h-[2px] rounded-t-2xl" style={{ background: col.accent }} />

      <div className="px-3 pt-3 pb-2" onClick={onClick}>
        <p className="text-[13px] font-black text-slate-900 leading-tight truncate">{lead.company_name}</p>
        {lead.contact_name && (
          <p className="mt-0.5 text-[11px] text-slate-500 truncate">{lead.contact_name}</p>
        )}
        {lead.phone && (
          <p className="mt-1 text-[11px] text-slate-400">{lead.phone}</p>
        )}

        <div className="mt-2 flex items-center justify-between">
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500 truncate max-w-[100px]">
            {SOURCE_LABEL[lead.source] ?? lead.source}
          </span>
          <span className={`text-[11px] font-medium ${daysColor}`}>
            {days === 0 ? 'hoje' : `${days}d`}
          </span>
        </div>
      </div>

      {/* Move buttons */}
      <div className="flex items-center gap-1 border-t border-slate-50 px-3 py-1.5">
        <button
          disabled={!canBack}
          onClick={() => canBack && onMove(lead.id, PIPELINE_ORDER[colIdx - 1]!)}
          className="rounded-lg p-1 text-slate-300 hover:bg-slate-50 hover:text-slate-600 disabled:opacity-20 disabled:cursor-not-allowed"
          title="Voltar etapa"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M15 18l-6-6 6-6"/>
          </svg>
        </button>
        <span className="flex-1 text-center text-[9px] font-bold uppercase tracking-widest text-slate-300">{col.label}</span>
        <button
          disabled={!canFwd}
          onClick={() => canFwd && onMove(lead.id, PIPELINE_ORDER[colIdx + 1]!)}
          className="rounded-lg p-1 text-slate-300 hover:bg-slate-50 hover:text-green-500 disabled:opacity-20 disabled:cursor-not-allowed"
          title="Avançar etapa"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M9 18l6-6-6-6"/>
          </svg>
        </button>
      </div>
    </div>
  )
}

// ── Main CRM page ──────────────────────────────────────────────────────────────
export default function CrmPage() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [units, setUnits] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [selected, setSelected] = useState<Lead | null>(null)

  const load = useCallback(async () => {
    const supabase = createClient()
    const [{ data: leadData }, { data: unitData }] = await Promise.all([
      supabase.from('leads').select('*').order('updated_at', { ascending: false }),
      supabase.from('units').select('id, name').order('name'),
    ])
    setLeads((leadData ?? []) as Lead[])
    setUnits((unitData ?? []) as { id: string; name: string }[])
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  async function moveLead(id: string, newStatus: LeadStatus) {
    // Optimistic update
    setLeads((prev) =>
      prev.map((l) => l.id === id ? { ...l, status: newStatus, updated_at: new Date().toISOString() } : l)
    )
    if (selected?.id === id) setSelected((p) => p ? { ...p, status: newStatus } : p)
    const supabase = createClient()
    await supabase.from('leads').update({ status: newStatus, updated_at: new Date().toISOString() }).eq('id', id)
  }

  function handleAdd(lead: Lead) {
    setLeads((p) => [lead, ...p])
  }

  function handleUpdate(updated: Lead) {
    setLeads((p) => p.map((l) => l.id === updated.id ? updated : l))
    setSelected(updated)
  }

  // KPIs
  const total = leads.length
  const qualified = leads.filter((l) => ['negotiating', 'won'].includes(l.status)).length
  const won = leads.filter((l) => l.status === 'won').length
  const convRate = total > 0 ? Math.round((won / total) * 100) : 0
  const qualRate = total > 0 ? Math.round((qualified / total) * 100) : 0

  const kpis = [
    { label: 'Total de Leads', val: total, color: '#6366f1' },
    { label: 'Qualificados', val: qualified, color: '#7c3aed' },
    { label: 'Convertidos', val: won, color: '#16a34a' },
    { label: 'Taxa Conversão', val: `${convRate}%`, color: '#0ea5e9' },
    { label: 'Taxa Qualificação', val: `${qualRate}%`, color: '#f59e0b' },
  ]

  return (
    <div className="flex flex-col gap-6 min-h-0">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-black text-slate-900">Pipeline CRM</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Gerencie seus leads no funil de vendas — mova com as setas em cada card.
          </p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-bold text-white"
          style={{ background: 'linear-gradient(135deg,#22c55e 0%,#16a34a 100%)', boxShadow: '0 4px 14px rgba(34,197,94,0.35)' }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M12 5v14M5 12h14"/>
          </svg>
          Novo Lead
        </button>
      </div>

      {/* KPI bar */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {kpis.map((k) => (
          <div
            key={k.label}
            className="rounded-2xl bg-white px-4 py-3"
            style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 0 0 1px rgba(226,232,240,0.8)' }}
          >
            <div className="h-[3px] w-8 rounded-full mb-2" style={{ background: k.color }} />
            <p className="text-[22px] font-black text-slate-900 leading-none">{k.val}</p>
            <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400">{k.label}</p>
          </div>
        ))}
      </div>

      {/* Kanban board */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-sm text-slate-400">
          Carregando leads...
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-4" style={{ minHeight: '60vh' }}>
          {COLUMNS.map((col) => {
            const colLeads = leads.filter((l) => l.status === col.status)
            return (
              <div
                key={col.status}
                className="flex-shrink-0 w-56 flex flex-col rounded-2xl"
                style={{ background: col.bg, border: '1px solid rgba(226,232,240,0.6)' }}
              >
                {/* Column header */}
                <div className="h-[3px] rounded-t-2xl" style={{ background: col.accent }} />
                <div className="flex items-center justify-between px-3 py-2.5">
                  <span className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-600">
                    {col.label}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${col.badge}`}>
                    {colLeads.length}
                  </span>
                </div>

                {/* Cards */}
                <div className="flex flex-col gap-2 p-2 flex-1">
                  {colLeads.length === 0 && (
                    <div className="flex items-center justify-center py-8 text-[11px] text-slate-400">
                      Nenhum lead
                    </div>
                  )}
                  {colLeads.map((lead) => (
                    <LeadCard
                      key={lead.id}
                      lead={lead}
                      col={col}
                      onMove={moveLead}
                      onClick={() => setSelected(lead)}
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Modals */}
      {showAdd && (
        <AddLeadModal units={units} onClose={() => setShowAdd(false)} onSave={handleAdd} />
      )}
      {selected && (
        <LeadDetail lead={selected} onClose={() => setSelected(null)} onUpdate={handleUpdate} />
      )}
    </div>
  )
}
