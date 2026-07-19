'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Loader2 } from 'lucide-react'
import { FormSection, Input, Label, Select, Textarea } from '@/components/ui/dashboard-ui'
import type { Customer, CustomerStatus } from '@/lib/types'

export function CustomerDetailForm({ customer, customerTerm }: { customer: Customer; customerTerm: string }) {
  const router = useRouter()
  const [form, setForm] = useState({
    phone: customer.phone ?? '',
    email: customer.email ?? '',
    address: customer.address ?? '',
    city: customer.city ?? '',
    status: customer.status,
    tags: customer.tags.join(', '),
    notes: customer.notes ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  async function handleSave() {
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      const res = await fetch(`/api/customers/${customer.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: form.phone.trim() || null,
          email: form.email.trim() || null,
          address: form.address.trim() || null,
          city: form.city.trim() || null,
          status: form.status,
          tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
          notes: form.notes.trim() || null,
        }),
      })
      const data = await res.json()
      setBusy(false)
      if (!res.ok) {
        setError(data.error ?? 'Não foi possível salvar. Tente novamente.')
        return
      }
      setSaved(true)
      router.refresh()
    } catch {
      setBusy(false)
      setError('Falha de conexão. Tente novamente.')
    }
  }

  return (
    <FormSection title={`Dados do ${customerTerm.toLowerCase()}`}>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label>Telefone</Label>
          <Input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder="(11) 99999-9999" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>E-mail</Label>
          <Input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder="cliente@email.com" />
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
        <Label>Status</Label>
        <Select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as CustomerStatus }))}>
          <option value="active">Ativo</option>
          <option value="inactive">Inativo</option>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Tags</Label>
        <Input value={form.tags} onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))} placeholder="separadas por vírgula, ex: vip, recorrente" />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Observações</Label>
        <Textarea rows={3} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Qualquer detalhe útil sobre este cliente" />
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex items-center gap-3 pt-2">
        <button
          onClick={handleSave}
          disabled={busy}
          className="flex items-center gap-1.5 rounded-xl px-5 py-2 text-sm font-bold text-white transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)', boxShadow: '0 4px 14px rgba(6,182,212,0.3)' }}
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
          {busy ? 'Salvando...' : 'Salvar alterações'}
        </button>
        {saved && !busy && <span className="text-xs font-semibold text-emerald-400">Salvo!</span>}
      </div>
    </FormSection>
  )
}
