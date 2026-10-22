'use client'

import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Input } from '@/components/ui/dashboard-ui'
import { itemsTotal, lineTotal, parseQuoteItems, validateQuoteItems } from '@/lib/portal-360/quote'
import { formatUsd } from '@/lib/portal-360/dashboard'

type Row = { description: string; quantity: string; unitPrice: string }

/**
 * Material da cotação item a item (descrição, quantidade, preço). É o que o CLIENTE vê no portal dele, com cada valor. Ao salvar, o total do
 * material da ordem passa a ser a soma das linhas (substitui a estimativa do técnico). Fica em custom_fields.quote_items.
 */
export function QuoteItemsEditor({ appointmentId, customFields, onSaved }: { appointmentId: string; customFields: Record<string, unknown> | null | undefined; onSaved: () => void | Promise<void> }) {
  const initial = parseQuoteItems(customFields)
  const [rows, setRows] = useState<Row[]>(initial.length > 0 ? initial.map((i) => ({ description: i.description, quantity: String(i.quantity), unitPrice: String(i.unitPrice) })) : [{ description: '', quantity: '1', unitPrice: '' }])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const parsed = validateQuoteItems(rows)
  const total = parsed.ok ? itemsTotal(parsed.items) : null

  function set(i: number, patch: Partial<Row>) {
    setRows((all) => all.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  }

  async function save() {
    if (!parsed.ok) return setMessage({ ok: false, text: parsed.error })
    setBusy(true)
    setMessage(null)
    const supabase = createClient()
    const { data: current } = await supabase.from('appointments').select('custom_fields').eq('id', appointmentId).maybeSingle()
    const merged = { ...((current as { custom_fields?: Record<string, unknown> } | null)?.custom_fields ?? {}) }
    if (parsed.items.length > 0) merged.quote_items = parsed.items
    else delete merged.quote_items
    const patch: Record<string, unknown> = { custom_fields: merged }
    if (parsed.items.length > 0) patch.service_order_material_value = itemsTotal(parsed.items)
    const { error } = await supabase.from('appointments').update(patch).eq('id', appointmentId)
    setBusy(false)
    if (error) return setMessage({ ok: false, text: 'Não foi possível salvar os itens.' })
    setMessage({ ok: true, text: parsed.items.length > 0 ? `Itens salvos. O cliente passa a ver cada valor; total do material ${formatUsd(itemsTotal(parsed.items))}.` : 'Itens removidos.' })
    await onSaved()
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-[11px] font-black uppercase tracking-wider text-indigo-300">Material da cotação (o cliente vê cada item e valor)</span>
      <div className="grid grid-cols-[1fr_70px_100px_90px_28px] items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
        <span>Item (em inglês)</span>
        <span>Qtd</span>
        <span>Preço un. (USD)</span>
        <span className="text-right">Total</span>
        <span />
      </div>
      {rows.map((r, i) => {
        const q = Number(r.quantity.replace(',', '.'))
        const p = Number(r.unitPrice.replace(/[$,\s]/g, ''))
        return (
          <div key={i} className="grid grid-cols-[1fr_70px_100px_90px_28px] items-center gap-1.5">
            <Input value={r.description} onChange={(e) => set(i, { description: e.target.value })} placeholder="Exit sign LED" maxLength={200} />
            <Input value={r.quantity} onChange={(e) => set(i, { quantity: e.target.value })} inputMode="decimal" />
            <Input value={r.unitPrice} onChange={(e) => set(i, { unitPrice: e.target.value })} inputMode="decimal" placeholder="0.00" />
            <span className="text-right text-xs font-semibold text-slate-200">{Number.isFinite(q) && Number.isFinite(p) && r.unitPrice.trim() ? formatUsd(lineTotal({ quantity: q, unitPrice: p })) : '—'}</span>
            <button type="button" aria-label="Remover linha" onClick={() => setRows((all) => (all.length > 1 ? all.filter((_, idx) => idx !== i) : [{ description: '', quantity: '1', unitPrice: '' }]))} className="text-slate-500 hover:text-red-400">
              <Trash2 size={14} />
            </button>
          </div>
        )
      })}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => setRows((all) => [...all, { description: '', quantity: '1', unitPrice: '' }])} className="inline-flex items-center gap-1 text-xs font-bold text-cyan-300 hover:text-cyan-200">
          <Plus size={13} /> Adicionar item
        </button>
        <span className="ml-auto text-xs text-slate-300">Total do material: <span className="font-black text-white">{total != null ? formatUsd(total) : '—'}</span></span>
        <button type="button" disabled={busy} onClick={() => void save()} className="rounded-lg px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50" style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)' }}>
          {busy ? 'Salvando…' : 'Salvar itens'}
        </button>
      </div>
      {message && (
        <p role={message.ok ? 'status' : 'alert'} className={`text-xs font-semibold ${message.ok ? 'text-emerald-400' : 'text-red-400'}`}>
          {message.text}
        </p>
      )}
    </div>
  )
}
