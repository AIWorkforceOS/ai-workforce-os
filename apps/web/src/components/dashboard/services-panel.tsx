'use client'

import { useState, type FormEvent } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Service } from '@/lib/types'
import {
  FormSection,
  Input,
  Label,
  StatusPill,
  TableShell,
  Td,
  Th,
  Tr,
} from '@/components/ui/dashboard-ui'

type ServiceFormState = {
  name: string
  duration_minutes: string
  buffer_minutes: string
  capacity_per_slot: string
  price: string
}

const EMPTY_FORM: ServiceFormState = {
  name: '',
  duration_minutes: '60',
  buffer_minutes: '0',
  capacity_per_slot: '1',
  price: '',
}

function formatPrice(price: number | null) {
  if (price === null) return '—'
  return price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export function ServicesPanel({
  unitId,
  orgId,
  initialServices,
}: {
  unitId: string
  orgId: string
  initialServices: Service[]
}) {
  const [services, setServices] = useState<Service[]>(initialServices)
  const [form, setForm] = useState<ServiceFormState>(EMPTY_FORM)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function resetForm() {
    setForm(EMPTY_FORM)
    setEditingId(null)
  }

  function handleEdit(service: Service) {
    setEditingId(service.id)
    setForm({
      name: service.name,
      duration_minutes: String(service.duration_minutes),
      buffer_minutes: String(service.buffer_minutes),
      capacity_per_slot: String(service.capacity_per_slot),
      price: service.price === null ? '' : String(service.price),
    })
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setLoading(true)

    const supabase = createClient()
    const payload = {
      name: form.name.trim(),
      duration_minutes: Number(form.duration_minutes) || 60,
      buffer_minutes: Number(form.buffer_minutes) || 0,
      capacity_per_slot: Number(form.capacity_per_slot) || 1,
      price: form.price.trim() === '' ? null : Number(form.price),
    }

    if (editingId) {
      const { data, error: saveError } = await supabase
        .from('services')
        .update(payload)
        .eq('id', editingId)
        .select()
        .single()
      setLoading(false)
      if (saveError || !data) {
        setError('Não foi possível salvar o serviço.')
        return
      }
      setServices((prev) => prev.map((s) => (s.id === editingId ? (data as Service) : s)))
      resetForm()
      return
    }

    const { data, error: insertError } = await supabase
      .from('services')
      .insert({ ...payload, org_id: orgId, unit_id: unitId })
      .select()
      .single()

    setLoading(false)

    if (insertError || !data) {
      setError('Não foi possível criar o serviço.')
      return
    }

    setServices((prev) => [data as Service, ...prev])
    resetForm()
  }

  async function handleToggleActive(service: Service) {
    const supabase = createClient()
    const { data, error: toggleError } = await supabase
      .from('services')
      .update({ is_active: !service.is_active })
      .eq('id', service.id)
      .select()
      .single()

    if (toggleError || !data) return
    setServices((prev) => prev.map((s) => (s.id === service.id ? (data as Service) : s)))
  }

  async function handleDelete(service: Service) {
    if (!window.confirm(`Excluir o serviço "${service.name}"?`)) return
    const supabase = createClient()
    const { error: deleteError } = await supabase.from('services').delete().eq('id', service.id)
    if (deleteError) return
    setServices((prev) => prev.filter((s) => s.id !== service.id))
    if (editingId === service.id) resetForm()
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={handleSubmit}>
        <FormSection title={editingId ? 'Editar serviço' : 'Novo serviço'}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex flex-col gap-1.5 sm:col-span-2 lg:col-span-1">
              <Label htmlFor="serviceName">Nome *</Label>
              <Input
                id="serviceName"
                required
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Corte de cabelo"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="serviceDuration">Duração (min)</Label>
              <Input
                id="serviceDuration"
                type="number"
                min={5}
                step={5}
                value={form.duration_minutes}
                onChange={(e) => setForm((f) => ({ ...f, duration_minutes: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="serviceBuffer">Buffer após (min)</Label>
              <Input
                id="serviceBuffer"
                type="number"
                min={0}
                step={5}
                value={form.buffer_minutes}
                onChange={(e) => setForm((f) => ({ ...f, buffer_minutes: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="serviceCapacity">Capacidade por slot</Label>
              <Input
                id="serviceCapacity"
                type="number"
                min={1}
                value={form.capacity_per_slot}
                onChange={(e) => setForm((f) => ({ ...f, capacity_per_slot: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="servicePrice">Preço (R$, opcional)</Label>
              <Input
                id="servicePrice"
                type="number"
                min={0}
                step="0.01"
                value={form.price}
                onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                placeholder="Sem preço fixo"
              />
            </div>
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={loading}
              className="self-start rounded-xl px-4 py-2 text-sm font-bold text-white transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)', boxShadow: '0 4px 14px rgba(6,182,212,0.3)' }}
            >
              {loading ? 'Salvando...' : editingId ? 'Salvar alterações' : 'Adicionar serviço'}
            </button>
            {editingId && (
              <button
                type="button"
                onClick={resetForm}
                className="rounded-xl px-4 py-2 text-sm text-slate-300 hover:bg-white/5"
                style={{ border: '1px solid rgba(255,255,255,0.08)' }}
              >
                Cancelar
              </button>
            )}
          </div>
        </FormSection>
      </form>

      {services.length > 0 && (
        <div className="overflow-hidden rounded-2xl bg-[#141a2b]" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.06)' }}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <TableShell>
                <Th>Nome</Th>
                <Th>Duração</Th>
                <Th>Buffer</Th>
                <Th>Capacidade</Th>
                <Th>Preço</Th>
                <Th>Status</Th>
                <Th>Ações</Th>
              </TableShell>
              <tbody>
                {services.map((service) => (
                  <Tr key={service.id}>
                    <Td className="font-semibold text-white">{service.name}</Td>
                    <Td className="text-slate-400">{service.duration_minutes} min</Td>
                    <Td className="text-slate-400">{service.buffer_minutes} min</Td>
                    <Td className="text-slate-400">{service.capacity_per_slot}</Td>
                    <Td className="text-slate-400">{formatPrice(service.price)}</Td>
                    <Td>
                      <button type="button" onClick={() => handleToggleActive(service)}>
                        <StatusPill variant={service.is_active ? 'green' : 'slate'}>
                          {service.is_active ? 'Ativo' : 'Inativo'}
                        </StatusPill>
                      </button>
                    </Td>
                    <Td>
                      <div className="flex gap-3 text-xs font-semibold">
                        <button type="button" className="text-cyan-400 hover:text-cyan-300" onClick={() => handleEdit(service)}>
                          Editar
                        </button>
                        <button type="button" className="text-red-400 hover:text-red-300" onClick={() => handleDelete(service)}>
                          Excluir
                        </button>
                      </div>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
