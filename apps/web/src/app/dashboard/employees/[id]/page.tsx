'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { FormSection, Input, Label, Select } from '@/components/ui/dashboard-ui'
import type { Employee } from '@/lib/types'

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

type FormState = {
  name: string
  email: string
  phone: string
  role: string
  specialty: string
  default_pay: string
  default_pay_type: string
  is_active: boolean
}

export default function EditEmployeePage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const supabase = createClient()

  const [form, setForm] = useState<FormState | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .from('employees')
      .select('*')
      .eq('id', params.id)
      .maybeSingle()
      .then(({ data }) => {
        const emp = data as Employee | null
        if (!emp) {
          setNotFound(true)
          return
        }
        setForm({
          name: emp.name,
          email: emp.email ?? '',
          phone: emp.phone ?? '',
          role: emp.role,
          specialty: emp.specialty ?? '',
          default_pay: emp.default_pay === null ? '' : String(emp.default_pay),
          default_pay_type: emp.default_pay_type ?? 'per_service',
          is_active: emp.is_active,
        })
      })
  }, [params.id])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form) return
    setBusy(true)
    setError(null)
    const { error: err } = await supabase
      .from('employees')
      .update({
        name: form.name,
        email: form.email || null,
        phone: form.phone || null,
        role: form.role,
        specialty: form.specialty.trim() || null,
        default_pay: form.default_pay.trim() === '' ? null : Number(form.default_pay),
        default_pay_type: form.default_pay_type,
        is_active: form.is_active,
      })
      .eq('id', params.id)
    setBusy(false)
    if (err) { setError(err.message); return }
    router.push('/dashboard/employees')
    router.refresh()
  }

  if (notFound) {
    return (
      <div className="mx-auto max-w-lg">
        <p className="text-sm text-slate-400">Funcionário não encontrado.</p>
        <Link href="/dashboard/employees" className="text-sm text-cyan-400 hover:text-cyan-300">← Voltar para a equipe</Link>
      </div>
    )
  }

  if (!form) {
    return <p className="text-sm text-slate-500">Carregando…</p>
  }

  return (
    <div className="mx-auto max-w-lg">
      <div className="mb-6">
        <Link href="/dashboard/employees" className="text-sm text-slate-400 hover:text-white">← Funcionários</Link>
        <h1 className="mt-2 text-2xl font-black tracking-tight text-white">Editar funcionário</h1>
      </div>

      <form onSubmit={handleSubmit}>
        <FormSection title="Dados do funcionário">
          <div className="flex flex-col gap-1.5">
            <Label>Nome completo *</Label>
            <Input required value={form.name} onChange={e => setForm(f => f && ({ ...f, name: e.target.value }))} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>E-mail</Label>
              <Input type="email" value={form.email} onChange={e => setForm(f => f && ({ ...f, email: e.target.value }))} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Telefone</Label>
              <Input value={form.phone} onChange={e => setForm(f => f && ({ ...f, phone: e.target.value }))} />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Cargo</Label>
            <Select value={form.role} onChange={e => setForm(f => f && ({ ...f, role: e.target.value }))}>
              {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Especialidade / função</Label>
            <Input value={form.specialty} onChange={e => setForm(f => f && ({ ...f, specialty: e.target.value }))} placeholder="Ex.: Limpeza residencial, Deep clean" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Valor padrão a pagar</Label>
              <Input type="number" min={0} step="0.01" value={form.default_pay} onChange={e => setForm(f => f && ({ ...f, default_pay: e.target.value }))} placeholder="Ex.: 120.00" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Tipo de pagamento</Label>
              <Select value={form.default_pay_type} onChange={e => setForm(f => f && ({ ...f, default_pay_type: e.target.value }))}>
                {PAY_TYPES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </Select>
            </div>
          </div>
          <p className="-mt-2 text-[11px] text-slate-500">
            Usado para sugerir o valor a pagar ao lançar um serviço executado — sempre editável em cada lançamento.
          </p>

          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={e => setForm(f => f && ({ ...f, is_active: e.target.checked }))}
            />
            Funcionário ativo
          </label>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={busy}
              className="flex-1 rounded-xl py-2 text-sm font-bold text-white transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)', boxShadow: '0 4px 14px rgba(6,182,212,0.3)' }}
            >
              {busy ? 'Salvando...' : 'Salvar alterações'}
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
