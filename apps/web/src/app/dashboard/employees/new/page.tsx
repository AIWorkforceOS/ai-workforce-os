'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { FormSection, Input, Label, Select } from '@/components/ui/dashboard-ui'

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
        <Link href="/dashboard/employees" className="text-sm text-slate-400 hover:text-white">← Funcionários</Link>
        <h1 className="mt-2 text-2xl font-black tracking-tight text-white">Novo funcionário</h1>
      </div>

      <form onSubmit={handleSubmit}>
        <FormSection title="Dados do funcionário">
          <div className="flex flex-col gap-1.5">
            <Label>Nome completo *</Label>
            <Input required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="João da Silva" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>E-mail</Label>
              <Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="joao@empresa.com" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Telefone</Label>
              <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="(11) 99999-9999" />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Cargo</Label>
            <Select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
              {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Empresa</Label>
            <Select value={form.org_id} onChange={e => setForm(f => ({ ...f, org_id: e.target.value, unit_id: '' }))}>
              <option value="">Selecionar empresa...</option>
              {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Unidade</Label>
            <Select value={form.unit_id} onChange={e => setForm(f => ({ ...f, unit_id: e.target.value }))}>
              <option value="">Selecionar unidade...</option>
              {filteredUnits.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </Select>
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={busy}
              className="flex-1 rounded-xl py-2 text-sm font-bold text-white transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)', boxShadow: '0 4px 14px rgba(6,182,212,0.3)' }}
            >
              {busy ? 'Salvando...' : 'Cadastrar funcionário'}
            </button>
            <Link
              href="/dashboard/employees"
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
