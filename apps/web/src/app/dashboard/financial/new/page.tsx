'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

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
    supabase.from('organizations').select('id, name').order('name').then(({ data }) => setOrgs(data ?? []))
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
        <Link href="/dashboard/financial" className="text-sm text-slate-500 hover:text-slate-700">← Financeiro</Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">Novo lançamento</h1>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        {/* Type toggle */}
        <div className="flex gap-2">
          {(['receivable', 'payable'] as const).map((t) => (
            <button key={t} type="button" onClick={() => setForm(f => ({ ...f, type: t }))}
              className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${
                form.type === t
                  ? t === 'receivable' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
                  : 'border border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}>
              {t === 'receivable' ? '📥 A receber' : '📤 A pagar'}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-slate-700">Descrição *</label>
          <input required value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
            placeholder="Ex: Mensalidade Unidade SP - Julho 2026" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-700">Valor (R$) *</label>
            <input required value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
              placeholder="1500,00" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-700">Vencimento</label>
            <input type="date" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400" />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-slate-700">Categoria</label>
          <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400">
            {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-700">Empresa</label>
            <select value={form.org_id} onChange={e => setForm(f => ({ ...f, org_id: e.target.value, unit_id: '' }))}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400">
              <option value="">Todas / Geral</option>
              {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-700">Unidade</label>
            <select value={form.unit_id} onChange={e => setForm(f => ({ ...f, unit_id: e.target.value }))}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400">
              <option value="">Selecionar...</option>
              {filteredUnits.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-slate-700">Observações</label>
          <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
            rows={2}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
            placeholder="Informações adicionais..." />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-3 pt-2">
          <button type="submit" disabled={busy}
            className="flex-1 rounded-lg bg-green-600 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50">
            {busy ? 'Salvando...' : 'Registrar lançamento'}
          </button>
          <Link href="/dashboard/financial"
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">
            Cancelar
          </Link>
        </div>
      </form>
    </div>
  )
}
