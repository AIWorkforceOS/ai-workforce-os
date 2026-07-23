'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { UserPlus } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { FormSection, Input, Label, Select, Textarea } from '@/components/ui/dashboard-ui'
import { DynamicFieldsForm } from '@/components/dashboard/dynamic-fields-form'
import { ServiceRecurrenceFields } from '@/components/dashboard/service-recurrence-fields'
import type { ServiceRecurrence } from '@/lib/scheduling/service-recurrence'
import type { DynamicField } from '@/lib/verticals/catalog'

type UnitOption = { id: string; name: string }

export function NewCustomerForm({
  customerTerm,
  customerTermPlural,
  customFieldSchema,
  showServiceFields = false,
}: {
  customerTerm: string
  customerTermPlural: string
  customFieldSchema: DynamicField[]
  /** modo gestão completa: cadastro ganha tipo de serviço, valor e recorrência (custom_fields) */
  showServiceFields?: boolean
}) {
  const router = useRouter()
  const [units, setUnits] = useState<UnitOption[]>([])
  const [form, setForm] = useState({
    unit_id: '',
    name: '',
    phone: '',
    email: '',
    address: '',
    city: '',
    tags: '',
    notes: '',
  })
  const [customFields, setCustomFields] = useState<Record<string, unknown>>({})
  // Serviço contratado (modo gestão completa) — vira chaves em custom_fields:
  // service_type / service_value / service_recurrence ({ type, days? }).
  const [service, setService] = useState<{ type: string; value: string; recurrence: ServiceRecurrence }>({
    type: '',
    value: '',
    recurrence: { type: 'once' },
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createClient()
    supabase
      .from('units')
      .select('id, name')
      .order('name')
      .then(({ data }) => {
        const rows = (data ?? []) as UnitOption[]
        setUnits(rows)
        if (rows.length > 0) setForm((f) => ({ ...f, unit_id: f.unit_id || rows[0]!.id }))
      })
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim() || !form.unit_id) {
      setError(`Escolha a unidade e o nome do ${customerTerm.toLowerCase()}.`)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          unit_id: form.unit_id,
          name: form.name.trim(),
          phone: form.phone.trim() || null,
          email: form.email.trim() || null,
          address: form.address.trim() || null,
          city: form.city.trim() || null,
          tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
          notes: form.notes.trim() || null,
          custom_fields: {
            ...customFields,
            ...(showServiceFields
              ? {
                  ...(service.type.trim() ? { service_type: service.type.trim() } : {}),
                  ...(Number(service.value) > 0 ? { service_value: Number(service.value) } : {}),
                  service_recurrence: service.recurrence,
                }
              : {}),
          },
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? `Não foi possível cadastrar o ${customerTerm.toLowerCase()}. Tente novamente.`)
        setBusy(false)
        return
      }
      router.push(data.customer?.id ? `/dashboard/receptionist/customers/${data.customer.id}` : '/dashboard/receptionist/customers')
      router.refresh()
    } catch {
      setError('Falha de conexão. Tente novamente.')
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <p className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-500">ai receptionist</p>
        <Link href="/dashboard/receptionist/customers" className="text-sm text-slate-400 hover:text-white">← {customerTermPlural}</Link>
        <h1 className="mt-2 text-2xl font-black tracking-tight text-white">Novo {customerTerm.toLowerCase()}</h1>
      </div>

      <form onSubmit={handleSubmit}>
        <FormSection title={`Dados do ${customerTerm.toLowerCase()}`}>
          <div className="flex flex-col gap-1.5">
            <Label>Unidade *</Label>
            <Select value={form.unit_id} onChange={(e) => setForm((f) => ({ ...f, unit_id: e.target.value }))}>
              {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Nome *</Label>
            <Input required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder={`Nome do ${customerTerm.toLowerCase()} ou da empresa`} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Telefone</Label>
              <Input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder="(11) 99999-9999" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>E-mail</Label>
              <Input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder={`${customerTerm.toLowerCase()}@email.com`} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Endereço</Label>
              <Input value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} placeholder="Rua, número" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Cidade</Label>
              <Input value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} placeholder="Cidade" />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Tags</Label>
            <Input value={form.tags} onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))} placeholder="separadas por vírgula, ex: vip, recorrente" />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Observações</Label>
            <Textarea rows={3} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder={`Qualquer detalhe útil sobre este ${customerTerm.toLowerCase()}`} />
          </div>
        </FormSection>

        {showServiceFields && (
          <div className="mt-6">
            <FormSection title="Serviço contratado">
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label>Tipo de serviço</Label>
                  <Input value={service.type} onChange={(e) => setService((s) => ({ ...s, type: e.target.value }))} placeholder="Ex: limpeza residencial, deep clean" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Valor do serviço</Label>
                  <Input type="number" min="0" step="0.01" value={service.value} onChange={(e) => setService((s) => ({ ...s, value: e.target.value }))} placeholder="Ex: 150" />
                </div>
              </div>
              <ServiceRecurrenceFields
                value={service.recurrence}
                onChange={(recurrence) => setService((s) => ({ ...s, recurrence }))}
              />
            </FormSection>
          </div>
        )}

        {customFieldSchema.length > 0 && (
          <div className="mt-6">
            <FormSection title="Informações específicas">
              <DynamicFieldsForm
                fields={customFieldSchema}
                values={customFields}
                onChange={(key, value) => setCustomFields((f) => ({ ...f, [key]: value }))}
              />
            </FormSection>
          </div>
        )}

        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

        <div className="mt-6 flex gap-3">
          <button
            type="submit"
            disabled={busy}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-sm font-bold text-white transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)', boxShadow: '0 4px 14px rgba(6,182,212,0.3)' }}
          >
            <UserPlus size={14} />
            {busy ? 'Salvando...' : `Cadastrar ${customerTerm.toLowerCase()}`}
          </button>
          <Link
            href="/dashboard/receptionist/customers"
            className="rounded-xl px-4 py-2 text-sm text-slate-300 hover:bg-white/5"
            style={{ border: '1px solid rgba(255,255,255,0.08)' }}
          >
            Cancelar
          </Link>
        </div>
      </form>
    </div>
  )
}
