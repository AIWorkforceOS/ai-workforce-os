'use client'

import { useEffect, useState, useCallback } from 'react'
import { Plus, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { Lead, LeadStatus } from '@/lib/types'
import {
  Badge,
  type BadgeVariant,
  Input,
  KpiCard,
  Label,
  PageHeader,
  Select,
  Textarea,
  brandGradient,
  cardShadow,
} from '@/components/ui/dashboard-ui'

// ── Column definitions ────────────────────────────────────────────────────────
const COLUMNS: {
  status: LeadStatus
  label: string
  accent: string        // gradient top bar
  bg: string            // column bg
  variant: BadgeVariant // count badge
}[] = [
  {
    status: 'new',
    label: 'Novo',
    accent: 'linear-gradient(90deg,#64748b,#94a3b8)',
    bg: 'rgba(255,255,255,0.02)',
    variant: 'slate',
  },
  {
    status: 'contacted',
    label: 'Em Contato',
    accent: 'linear-gradient(90deg,#2563eb,#3b82f6)',
    bg: 'rgba(59,130,246,0.04)',
    variant: 'blue',
  },
  {
    status: 'replied',
    label: 'Respondeu',
    accent: 'linear-gradient(90deg,#d97706,#f59e0b)',
    bg: 'rgba(245,158,11,0.04)',
    variant: 'amber',
  },
  {
    status: 'negotiating',
    label: 'Negociando',
    accent: 'linear-gradient(90deg,#7c3aed,#a78bfa)',
    bg: 'rgba(139,92,246,0.04)',
    variant: 'purple',
  },
  {
    status: 'won',
    label: 'Convertido',
    accent: 'linear-gradient(90deg,#16a34a,#22c55e)',
    bg: 'rgba(34,197,94,0.04)',
    variant: 'green',
  },
  {
    status: 'lost',
    label: 'Perdido',
    accent: 'linear-gradient(90deg,#dc2626,#f87171)',
    bg: 'rgba(239,68,68,0.04)',
    variant: 'red',
  },
]

const PIPELINE_ORDER: LeadStatus[] = ['new', 'contacted', 'replied', 'negotiating', 'won', 'lost']

const SOURCE_LABEL: Record<string, string> = {
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  indicacao: 'Indicação',
  site: 'Site',
  linkedin: 'LinkedIn',
  manual: 'Manual',
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
    // Via servidor (não insert direto): dispara o mesmo primeiro contato
    // automático do Sales Rep que já roda para leads de anúncio/intake
    // (lib/leads/lead-intake.ts) — ver /api/leads.
    const response = await fetch('/api/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        company_name: form.company_name.trim(),
        contact_name: form.contact_name.trim() || null,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        source: form.source,
        unit_id: form.unit_id,
        notes: form.notes.trim() || null,
      }),
    })
    const data = await response.json().catch(() => null)
    setSaving(false)
    if (!response.ok) { setError(data?.error ?? 'Erro ao criar lead.'); return }
    onSave(data.lead as Lead)
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-md rounded-2xl bg-[#141a2b]" style={{ boxShadow: `0 20px 60px rgba(0,0,0,0.5), ${cardShadow}` }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div>
            <p className="text-sm font-bold text-white">Novo Lead</p>
            <p className="text-xs text-slate-500">Adicionar manualmente ao pipeline</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-500 hover:bg-white/5 hover:text-slate-300">
            <X size={16} strokeWidth={2.5} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-3">
          {error && (
            <p className="rounded-lg px-3 py-2 text-xs text-red-400" style={{ background: 'rgba(239,68,68,0.1)' }}>{error}</p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 flex flex-col gap-1">
              <Label htmlFor="lead-company">Empresa *</Label>
              <Input
                id="lead-company"
                className="w-full"
                placeholder="Ex: Imobiliária Silva"
                value={form.company_name}
                onChange={(e) => set('company_name', e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="lead-contact">Contato</Label>
              <Input
                id="lead-contact"
                className="w-full"
                placeholder="Nome"
                value={form.contact_name}
                onChange={(e) => set('contact_name', e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="lead-phone">WhatsApp</Label>
              <Input
                id="lead-phone"
                className="w-full"
                placeholder="+55 11 9..."
                value={form.phone}
                onChange={(e) => set('phone', e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="lead-source">Origem</Label>
              <Select id="lead-source" className="w-full" value={form.source} onChange={(e) => set('source', e.target.value)}>
                {Object.entries(SOURCE_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="lead-unit">Unidade *</Label>
              <Select id="lead-unit" className="w-full" value={form.unit_id} onChange={(e) => set('unit_id', e.target.value)}>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </Select>
            </div>
            <div className="col-span-2 flex flex-col gap-1">
              <Label htmlFor="lead-notes">Observações</Label>
              <Textarea
                id="lead-notes"
                rows={2}
                className="w-full resize-none"
                placeholder="Contexto, interesse, etc."
                value={form.notes}
                onChange={(e) => set('notes', e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-3" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <button
            onClick={onClose}
            className="rounded-xl px-4 py-2 text-sm text-slate-300 hover:bg-white/5"
            style={{ border: '1px solid rgba(255,255,255,0.08)' }}
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            style={{ background: brandGradient, boxShadow: '0 2px 8px rgba(6,182,212,0.3)' }}
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
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="flex h-full w-full max-w-sm flex-col bg-[#141a2b]" style={{ boxShadow: '-8px 0 40px rgba(0,0,0,0.5)' }}>
        {/* Top accent */}
        <div className="h-[3px]" style={{ background: col.accent }} />

        {/* Header */}
        <div className="flex items-start justify-between px-5 pt-4 pb-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div>
            <p className="text-base font-black text-white">{lead.company_name}</p>
            {lead.contact_name && <p className="text-sm text-slate-400">{lead.contact_name}</p>}
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-500 hover:bg-white/5">
            <X size={16} strokeWidth={2.5} />
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
              <div key={label} className="rounded-xl px-3 py-2.5" style={{ background: 'rgba(255,255,255,0.03)' }}>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{label}</p>
                <p className="mt-0.5 text-sm font-medium text-slate-200 truncate">{val}</p>
              </div>
            ))}
          </div>

          {/* Notes */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="lead-detail-notes">Observações</Label>
            <Textarea
              id="lead-detail-notes"
              rows={5}
              className="w-full resize-none"
              placeholder="Histórico, interesse, objeções..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
            <button
              onClick={saveNotes}
              disabled={saving || notes === (lead.notes ?? '')}
              className="mt-1 w-full rounded-xl py-2 text-sm font-semibold text-white disabled:opacity-40"
              style={{ background: brandGradient }}
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
    days > 7 ? 'text-red-400' : days > 3 ? 'text-amber-400' : 'text-slate-500'

  return (
    <div
      className="rounded-2xl bg-[#1a2137] cursor-pointer group"
      style={{ boxShadow: cardShadow }}
    >
      {/* Top accent */}
      <div className="h-[2px] rounded-t-2xl" style={{ background: col.accent }} />

      <div className="px-3 pt-3 pb-2" onClick={onClick}>
        <p className="text-[13px] font-black text-white leading-tight truncate">{lead.company_name}</p>
        {lead.contact_name && (
          <p className="mt-0.5 text-[11px] text-slate-400 truncate">{lead.contact_name}</p>
        )}
        {lead.phone && (
          <p className="mt-1 text-[11px] text-slate-500">{lead.phone}</p>
        )}

        <div className="mt-2 flex items-center justify-between">
          <span className="rounded-full px-2 py-0.5 text-[10px] font-medium text-slate-400 truncate max-w-[100px]" style={{ background: 'rgba(255,255,255,0.06)' }}>
            {SOURCE_LABEL[lead.source] ?? lead.source}
          </span>
          <span className={`text-[11px] font-medium ${daysColor}`}>
            {days === 0 ? 'hoje' : `${days}d`}
          </span>
        </div>
      </div>

      {/* Move buttons */}
      <div className="flex items-center gap-1 px-3 py-1.5" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
        <button
          disabled={!canBack}
          onClick={() => canBack && onMove(lead.id, PIPELINE_ORDER[colIdx - 1]!)}
          className="rounded-lg p-1 text-slate-600 hover:bg-white/5 hover:text-slate-300 disabled:opacity-20 disabled:cursor-not-allowed"
          title="Voltar etapa"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M15 18l-6-6 6-6"/>
          </svg>
        </button>
        <span className="flex-1 text-center text-[9px] font-bold uppercase tracking-widest text-slate-600">{col.label}</span>
        <button
          disabled={!canFwd}
          onClick={() => canFwd && onMove(lead.id, PIPELINE_ORDER[colIdx + 1]!)}
          className="rounded-lg p-1 text-slate-600 hover:bg-white/5 hover:text-cyan-400 disabled:opacity-20 disabled:cursor-not-allowed"
          title="Avançar etapa"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M9 18l6-6-6-6"/>
          </svg>
        </button>
      </div>

      {/* Handoff Sales → Recruiter: lead convertido pode abrir vaga (§7.1) */}
      {lead.status === 'won' && (
        <div className="px-3 pb-2.5">
          <button
            onClick={async (e) => {
              e.stopPropagation()
              const title = window.prompt(`Abrir vaga para ${lead.company_name}.\n\nTítulo da vaga (ex.: Estágio em Marketing):`)
              if (!title?.trim()) return
              const response = await fetch('/api/jobs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ unit_id: lead.unit_id, lead_id: lead.id, title: title.trim(), source: 'manual' }),
              })
              const data = await response.json().catch(() => null)
              if (response.ok && data?.job?.id) {
                window.location.href = `/dashboard/recruiter/jobs/${data.job.id}`
              } else {
                window.alert(data?.error ?? 'Não foi possível criar a vaga.')
              }
            }}
            className="w-full rounded-lg py-1.5 text-[11px] font-bold text-white transition-all hover:scale-[1.01]"
            style={{ background: 'linear-gradient(135deg, #16a34a, #22c55e)' }}
          >
            Abrir vaga (Recrutador IA)
          </button>
        </div>
      )}
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
    { label: 'Total de Leads', value: String(total), gradient: 'from-indigo-400 to-indigo-500' },
    { label: 'Qualificados', value: String(qualified), gradient: 'from-purple-400 to-violet-500' },
    { label: 'Convertidos', value: String(won), gradient: 'from-green-400 to-emerald-500' },
    { label: 'Taxa Conversão', value: `${convRate}%`, gradient: 'from-cyan-400 to-blue-500' },
    { label: 'Taxa Qualificação', value: `${qualRate}%`, gradient: 'from-amber-400 to-orange-500' },
  ]

  return (
    <div className="flex flex-col gap-6 min-h-0">
      <PageHeader
        eyebrow="vendas"
        title="Pipeline CRM"
        subtitle="Gerencie seus leads no funil de vendas — mova com as setas em cada card."
        action={
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-bold text-white transition-all hover:scale-[1.02] active:scale-[0.98]"
            style={{ background: brandGradient, boxShadow: '0 4px 14px rgba(6,182,212,0.3)' }}
          >
            <Plus size={14} />
            Novo Lead
          </button>
        }
      />

      {/* KPI bar */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {kpis.map((k) => (
          <KpiCard key={k.label} label={k.label} value={k.value} gradient={k.gradient} />
        ))}
      </div>

      {/* Kanban board */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-sm text-slate-500">
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
                style={{ background: col.bg, border: '1px solid rgba(255,255,255,0.06)' }}
              >
                {/* Column header */}
                <div className="h-[3px] rounded-t-2xl" style={{ background: col.accent }} />
                <div className="flex items-center justify-between px-3 py-2.5">
                  <span className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-300">
                    {col.label}
                  </span>
                  <Badge variant={col.variant}>{colLeads.length}</Badge>
                </div>

                {/* Cards */}
                <div className="flex flex-col gap-2 p-2 flex-1">
                  {colLeads.length === 0 && (
                    <div className="flex items-center justify-center py-8 text-[11px] text-slate-600">
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
