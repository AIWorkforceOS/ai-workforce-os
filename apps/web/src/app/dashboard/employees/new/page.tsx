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
  { value: 'technician', label: 'Técnico (executa os serviços)' },
  { value: 'sdr', label: 'SDR' },
  { value: 'support', label: 'Suporte' },
]

const PAY_TYPES = [
  { value: 'per_service', label: 'Por serviço executado' },
  { value: 'per_hour', label: 'Por hora trabalhada' },
  { value: 'per_day', label: 'Diária' },
  { value: 'percent', label: '% do valor do serviço' },
]

export default function NewEmployeePage() {
  const router = useRouter()
  const supabase = createClient()
  const [orgs, setOrgs] = useState<Org[]>([])
  const [units, setUnits] = useState<Unit[]>([])
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    role: 'staff',
    specialty: '',
    default_pay: '',
    default_pay_type: 'per_service',
    org_id: '',
    unit_id: '',
    is_schedulable: true,
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
    const { error: err } = await supabase.from('employees').insert({
      name: form.name,
      email: form.email || null,
      phone: form.phone || null,
      role: form.role,
      specialty: form.specialty.trim() || null,
      default_pay: form.default_pay.trim() === '' ? null : Number(form.default_pay),
      default_pay_type: form.default_pay_type,
      org_id: form.org_id || null,
      unit_id: form.unit_id || null,
      is_schedulable: form.is_schedulable,
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
            <Label>Especialidade / função</Label>
            <Input value={form.specialty} onChange={e => setForm(f => ({ ...f, specialty: e.target.value }))} placeholder="Ex.: Limpeza residencial, Deep clean" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Valor padrão a pagar</Label>
              <Input type="number" min={0} step="0.01" value={form.default_pay} onChange={e => setForm(f => ({ ...f, default_pay: e.target.value }))} placeholder="Ex.: 120.00" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Tipo de pagamento</Label>
              <Select value={form.default_pay_type} onChange={e => setForm(f => ({ ...f, default_pay_type: e.target.value }))}>
                {PAY_TYPES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </Select>
            </div>
          </div>
          <p className="-mt-2 text-[11px] text-slate-500">
            Usado para sugerir o valor a pagar ao lançar um serviço executado — sempre editável em cada lançamento.
          </p>

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

          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={form.is_schedulable}
              onChange={e => setForm(f => ({ ...f, is_schedulable: e.target.checked }))}
              className="accent-cyan-500"
            />
            Atende agenda (aparece pra ser escalado em agendamentos)
          </label>

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
