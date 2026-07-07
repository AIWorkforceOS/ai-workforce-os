'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

type Org = { id: string; name: string }
type Unit = { id: string; name: string; org_id: string | null }

const ROLES = [
  { value: 'admin', label: 'Admin' },
  { value: 'manager', label: 'Gerente' },
  { value: 'staff', label: 'Colaborador' },
  { value: 'sdr', label: 'SDR' },
  { value: 'support', label: 'Suporte' },
]

export default function NewEmployeePage() {
  const router = useRouter()
  const supabase = createClient()
  const [orgs, setOrgs] = useState<Org[]>([])
  const [units, setUnits] = useState<Unit[]>([])
  const [form, setForm] = useState({ name: '', email: '', phone: '', role: 'staff', org_id: '', unit_id: '' })
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
    const { error: err } = await supabase.from('employees').insert({
      name: form.name,
      email: form.email || null,
      phone: form.phone || null,
      role: form.role,
      org_id: form.org_id || null,
      unit_id: form.unit_id || null,
    })
    setBusy(false)
    if (err) { setError(err.message); return }
    router.push('/dashboard/employees')
    router.refresh()
  }

  return (
    <div className="mx-auto max-w-lg">
      <div className="mb-6">
        <Link href="/dashboard/employees" className="text-sm text-gray-500 hover:text-gray-700">← Funcionários</Link>
        <h1 className="mt-2 text-2xl font-bold text-gray-900">Novo funcionário</h1>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-gray-700">Nome completo *</label>
          <input required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-gray-400" placeholder="João da Silva" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-gray-700">E-mail</label>
            <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-gray-400" placeholder="joao@empresa.com" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-gray-700">Telefone</label>
            <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-gray-400" placeholder="(11) 99999-9999" />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-gray-700">Cargo</label>
          <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-gray-400">
            {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-gray-700">Empresa</label>
          <select value={form.org_id} onChange={e => setForm(f => ({ ...f, org_id: e.target.value, unit_id: '' }))}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-gray-400">
            <option value="">Selecionar empresa...</option>
            {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-gray-700">Unidade</label>
          <select value={form.unit_id} onChange={e => setForm(f => ({ ...f, unit_id: e.target.value }))}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-gray-400">
            <option value="">Selecionar unidade...</option>
            {filteredUnits.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-3 pt-2">
          <button type="submit" disabled={busy}
            className="flex-1 rounded-lg bg-gray-900 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50">
            {busy ? 'Salvando...' : 'Cadastrar funcionário'}
          </button>
          <Link href="/dashboard/employees"
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">
            Cancelar
          </Link>
        </div>
      </form>
    </div>
  )
}
