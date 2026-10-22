'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Card, Input, Select } from '@/components/ui/dashboard-ui'
import { canDeleteStage, DEFAULT_STAGES, STAGE_COLORS, STAGE_KINDS, validateStageSet, type StageColor, type StageRow } from '@/lib/crm/stages'
import type { LeadStatus } from '@/lib/types'

type Draft = { id: string | null; name: string; kind: LeadStatus; color: StageColor }

const toDrafts = (rows: StageRow[]): Draft[] => [...rows].sort((a, b) => a.position - b.position).map((r) => ({ id: r.id, name: r.name, kind: r.kind, color: r.color }))

export function StagesEditor({ orgId, initial }: { orgId: string; initial: StageRow[] }) {
  const router = useRouter()
  const [saved, setSaved] = useState<StageRow[]>(initial)
  const [drafts, setDrafts] = useState<Draft[]>(toDrafts(initial))
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const custom = saved.length > 0
  const dirty = JSON.stringify(drafts) !== JSON.stringify(toDrafts(saved))

  function update(i: number, patch: Partial<Draft>) {
    setDrafts((d) => d.map((x, idx) => (idx === i ? { ...x, ...patch } : x)))
  }
  function move(i: number, dir: -1 | 1) {
    setDrafts((d) => {
      const j = i + dir
      if (j < 0 || j >= d.length) return d
      const next = [...d]
      ;[next[i], next[j]] = [next[j]!, next[i]!]
      return next
    })
  }

  async function reload() {
    const { data } = await createClient().from('crm_stages').select('id, name, kind, color, position').eq('org_id', orgId).order('position')
    const rows = (data ?? []) as StageRow[]
    setSaved(rows)
    setDrafts(toDrafts(rows))
    router.refresh()
  }

  async function start() {
    setBusy(true)
    setMessage(null)
    const { error } = await createClient().from('crm_stages').insert(DEFAULT_STAGES.map((s) => ({ org_id: orgId, name: s.name, kind: s.kind, color: s.color, position: s.position })))
    setBusy(false)
    if (error) return setMessage({ ok: false, text: 'Não foi possível criar as etapas. Tente de novo.' })
    setMessage({ ok: true, text: 'Funil personalizável. Edite as etapas abaixo.' })
    await reload()
  }

  async function save() {
    const problem = validateStageSet(drafts)
    if (problem) return setMessage({ ok: false, text: problem })
    setBusy(true)
    setMessage(null)
    const supabase = createClient()
    const keep = new Set(drafts.filter((d) => d.id).map((d) => d.id!))
    // 1) apaga as removidas (os leads delas voltam para a primeira etapa do mesmo comportamento)
    const removed = saved.filter((s) => !keep.has(s.id)).map((s) => s.id)
    if (removed.length > 0) {
      const del = await supabase.from('crm_stages').delete().in('id', removed)
      if (del.error) {
        setBusy(false)
        return setMessage({ ok: false, text: 'Não foi possível apagar etapas. Nada mais foi alterado.' })
      }
    }
    // 2) atualiza as existentes e cria as novas, já na ordem final
    for (const [position, d] of drafts.entries()) {
      const res = d.id
        ? await supabase.from('crm_stages').update({ name: d.name.trim().replace(/\s+/g, ' '), kind: d.kind, color: d.color, position }).eq('id', d.id)
        : await supabase.from('crm_stages').insert({ org_id: orgId, name: d.name.trim().replace(/\s+/g, ' '), kind: d.kind, color: d.color, position })
      if (res.error) {
        setBusy(false)
        await reload()
        return setMessage({ ok: false, text: /duplicate|unique/i.test(res.error.message) ? `Já existe uma etapa chamada "${d.name.trim()}".` : 'Não foi possível salvar uma das etapas. Confira e tente de novo.' })
      }
    }
    setBusy(false)
    setMessage({ ok: true, text: 'Funil salvo. O quadro do CRM já usa as novas etapas.' })
    await reload()
  }

  async function resetToDefault() {
    if (!window.confirm('Voltar ao funil padrão de 6 etapas? Suas etapas personalizadas serão apagadas; os leads continuam, cada um na etapa padrão do seu status.')) return
    setBusy(true)
    const { error } = await createClient().from('crm_stages').delete().eq('org_id', orgId)
    setBusy(false)
    if (error) return setMessage({ ok: false, text: 'Não foi possível voltar ao padrão.' })
    setMessage({ ok: true, text: 'Funil padrão restaurado.' })
    await reload()
  }

  if (!custom) {
    return (
      <Card className="p-5">
        <h2 className="text-sm font-bold text-white">Funil padrão</h2>
        <p className="mt-1 text-xs text-slate-400">Hoje o funil usa as 6 etapas de fábrica:</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {DEFAULT_STAGES.map((s) => (
            <span key={s.name} className="rounded-lg px-3 py-1.5 text-xs font-bold text-slate-200" style={{ background: 'rgba(255,255,255,0.06)', borderTop: `2px solid ${STAGE_COLORS[s.color].accent.match(/#[0-9a-f]{6}/i)?.[0] ?? '#64748b'}` }}>
              {s.name}
            </span>
          ))}
        </div>
        <button type="button" disabled={busy} onClick={() => void start()} className="mt-4 rounded-xl px-4 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)' }}>
          {busy ? 'Preparando…' : 'Personalizar o funil'}
        </button>
        {message && <p role={message.ok ? 'status' : 'alert'} className={`mt-3 text-xs font-semibold ${message.ok ? 'text-emerald-400' : 'text-red-400'}`}>{message.text}</p>}
      </Card>
    )
  }

  return (
    <Card className="p-5">
      <div className="flex flex-col gap-2">
        {drafts.map((d, i) => {
          const blocked = d.id ? canDeleteStage(drafts.filter((x) => x.id).map((x) => ({ id: x.id!, kind: x.kind })), d.id) : null
          return (
            <div key={d.id ?? `new-${i}`} className="flex flex-wrap items-center gap-2 rounded-xl px-3 py-2" style={{ background: 'rgba(255,255,255,0.03)', borderLeft: `3px solid ${STAGE_COLORS[d.color].accent.match(/#[0-9a-f]{6}/i)?.[0] ?? '#64748b'}` }}>
              <div className="flex flex-col">
                <button type="button" aria-label="Subir" disabled={i === 0} onClick={() => move(i, -1)} className="text-slate-500 hover:text-white disabled:opacity-20"><ArrowUp size={13} /></button>
                <button type="button" aria-label="Descer" disabled={i === drafts.length - 1} onClick={() => move(i, 1)} className="text-slate-500 hover:text-white disabled:opacity-20"><ArrowDown size={13} /></button>
              </div>
              <Input value={d.name} maxLength={40} onChange={(e) => update(i, { name: e.target.value })} aria-label="Nome da etapa" className="w-48" />
              <Select value={d.kind} onChange={(e) => update(i, { kind: e.target.value as LeadStatus })} aria-label="Conta como" className="py-1.5 text-xs">
                {STAGE_KINDS.map((k) => (
                  <option key={k.kind} value={k.kind}>
                    Conta como: {k.label}
                  </option>
                ))}
              </Select>
              <Select value={d.color} onChange={(e) => update(i, { color: e.target.value as StageColor })} aria-label="Cor" className="py-1.5 text-xs">
                {(Object.keys(STAGE_COLORS) as StageColor[]).map((c) => (
                  <option key={c} value={c}>
                    {STAGE_COLORS[c].label}
                  </option>
                ))}
              </Select>
              <button type="button" title={blocked ?? 'Apagar etapa'} disabled={Boolean(blocked) || drafts.length <= 1} onClick={() => setDrafts((all) => all.filter((_, idx) => idx !== i))} aria-label="Apagar etapa" className="ml-auto rounded-md p-1.5 text-slate-500 hover:bg-white/10 hover:text-red-400 disabled:opacity-25">
                <Trash2 size={14} />
              </button>
            </div>
          )
        })}
      </div>

      <button type="button" onClick={() => setDrafts((d) => [...d, { id: null, name: '', kind: 'negotiating', color: 'cyan' }])} className="mt-3 inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold text-slate-100" style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.18)' }}>
        <Plus size={13} />
        Adicionar etapa
      </button>

      <ul className="mt-4 list-disc pl-5 text-[11px] text-slate-500">
        <li>“Conta como” é o comportamento que os agentes e as métricas enxergam. “Convertido” conta como venda.</li>
        <li>O funil precisa de ao menos uma etapa que conte como Novo, uma como Convertido e uma como Perdido.</li>
        <li>Apagar uma etapa não apaga leads: eles passam para a primeira etapa do mesmo comportamento.</li>
      </ul>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" disabled={busy || !dirty} onClick={() => void save()} className="rounded-xl px-4 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)' }}>
          {busy ? 'Salvando…' : 'Salvar funil'}
        </button>
        {dirty && <button type="button" onClick={() => setDrafts(toDrafts(saved))} className="text-xs font-semibold text-slate-400 underline">Descartar alterações</button>}
        <button type="button" disabled={busy} onClick={() => void resetToDefault()} className="ml-auto text-xs font-semibold text-red-400 underline disabled:opacity-50">Voltar ao funil padrão</button>
      </div>
      {message && <p role={message.ok ? 'status' : 'alert'} className={`mt-3 text-xs font-semibold ${message.ok ? 'text-emerald-400' : 'text-red-400'}`}>{message.text}</p>}
    </Card>
  )
}
