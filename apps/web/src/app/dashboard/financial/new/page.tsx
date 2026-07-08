'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { FormSection, Input, Label, Select, Textarea } from '@/components/ui/dashboard-ui'

type Org = { id: string; name: string }
type Unit = { id: string; name: string; org_id: string | null }

const CATEGORIES = [
  { value: 'client_payment', label: 'Pagamento de cliente' },
  { value: 'system_cost', label: 'Custo do sistema' },
  { value: 'infrastructure', label: 'Infraestrutura' },
  { value: 'vendor', label: 'Fornecedor' },
  { value: 'other', label: 'Outro' },
]

export default function NewFinancialPage() {
  const router = useRouter()
  const supabase = createClient()
  const [orgs, setOrgs] = useState<Org[]>([])
  const [units, setUnits] = useState<Unit[]>([])
  const [form, setForm] = useState({
    type: 'receivable' as 'receivable' | 'payable',
    category: 'client_payment',
    description: '',
    amount: '',
    due_date: '',
    org_id: '',
    unit_id: '',
    notes: '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase.from('organizations').select('id, name').order('name').then(({ data }) => {
      const rows = data ?? []
      setOrgs(rows)
      // Cliente (RLS) só enxerga a própria empresa — pré-seleciona
      if (rows.length === 1) setForm(f => ({ ...f, org_id: rows[0]!.id }))
    })
    supabase.from('units').select('id, name, org_id').order('name').then(({ data }) => setUnits(data ?? []))
  }, [])

  const filteredUnits = form.org_id ? units.filter(u => u.org_id === form.org_id) : units

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error: err } = await supabase.from('financial_records').insert({
      type: form.type,
      category: form.category,
      description: form.description,
      amount: parseFloat(form.amount.replace(',', '.')),
      due_date: form.due_date || null,
      org_id: form.org_id || null,
      unit_id: form.unit_id || null,
      notes: form.notes || null,
    })
    setBusy(false)
    if (err) { setError(err.message); return }
    router.push('/dashboard/financial')
    router.refresh()
  }

  return (
    <div className="mx-auto max-w-lg">
      <div className="mb-6">
        <Link href="/dashboard/financial" className="text-sm text-slate-400 hover:text-white">← Financeiro</Link>
        <h1 className="mt-2 text-2xl font-black tracking-tight text-white">Novo lançamento</h1>
      </div>

      <form onSubmit={handleSubmit}>
        <FormSection title="Detalhes do lançamento">
          {/* Type toggle */}
          <div className="flex gap-2">
            {(['receivable', 'payable'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setForm(f => ({ ...f, type: t }))}
                className="flex-1 rounded-xl py-2 text-sm font-semibold transition-all"
                style={form.type === t
                  ? { background: t === 'receivable' ? 'linear-gradient(135deg,#22c55e,#16a34a)' : 'linear-gradient(135deg,#ef4444,#dc2626)', color: '#fff' }
                  : { border: '1px solid rgba(255,255,255,0.08)', color: '#cbd5e1' }}
              >
                {t === 'receivable' ? '📥 A receber' : '📤 A pagar'}
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Descrição *</Label>
            <Input required value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Ex: Mensalidade Unidade SP - Julho 2026" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Valor (R$) *</Label>
              <Input required value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} placeholder="1500,00" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Vencimento</Label>
              <Input type="date" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Categoria</Label>
            <Select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
              {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Empresa</Label>
              <Select value={form.org_id} onChange={e => setForm(f => ({ ...f, org_id: e.target.value, unit_id: '' }))}>
                <option value="">Todas / Geral</option>
                {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Unidade</Label>
              <Select value={form.unit_id} onChange={e => setForm(f => ({ ...f, unit_id: e.target.value }))}>
                <option value="">Selecionar...</option>
                {filteredUnits.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </Select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Observações</Label>
            <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} placeholder="Informações adicionais..." />
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={busy}
              className="flex-1 rounded-xl py-2 text-sm font-bold text-white transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)', boxShadow: '0 4px 14px rgba(6,182,212,0.3)' }}
            >
              {busy ? 'Salvando...' : 'Registrar lançamento'}
            </button>
            <Link
              href="/dashboard/financial"
              className="rounded-xl px-4 py-2 text-sm text-slate-300 hover:bg-white/5"
              style={{ border: '1px solid rgba(255,255,255,0.08)' }}
            >
              Cancelar
            </Link>
          </div>
        </FormSection>
      </form>
    </div>
  )
}
