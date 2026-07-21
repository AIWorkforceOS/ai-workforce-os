'use client'

import { useState, type FormEvent } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Resource, ResourceType } from '@/lib/types'
import {
  FormSection,
  Input,
  Label,
  Select,
  StatusPill,
  TableShell,
  Td,
  Th,
  Tr,
} from '@/components/ui/dashboard-ui'

type ResourceFormState = {
  name: string
  type: ResourceType
  capacity: string
}

const EMPTY_FORM: ResourceFormState = { name: '', type: 'room', capacity: '1' }

const TYPE_LABEL: Record<ResourceType, string> = { room: 'Sala', equipment: 'Equipamento' }

export function ResourcesPanel({
  unitId,
  orgId,
  initialResources,
}: {
  unitId: string
  orgId: string
  initialResources: Resource[]
}) {
  const [resources, setResources] = useState<Resource[]>(initialResources)
  const [form, setForm] = useState<ResourceFormState>(EMPTY_FORM)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function resetForm() {
    setForm(EMPTY_FORM)
    setEditingId(null)
  }

  function handleEdit(resource: Resource) {
    setEditingId(resource.id)
    setForm({ name: resource.name, type: resource.type, capacity: String(resource.capacity) })
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setLoading(true)

    const supabase = createClient()
    const payload = {
      name: form.name.trim(),
      type: form.type,
      capacity: Number(form.capacity) || 1,
    }

    if (editingId) {
      const { data, error: saveError } = await supabase
        .from('resources')
        .update(payload)
        .eq('id', editingId)
        .select()
        .single()
      setLoading(false)
      if (saveError || !data) {
        setError('Não foi possível salvar o recurso.')
        return
      }
      setResources((prev) => prev.map((r) => (r.id === editingId ? (data as Resource) : r)))
      resetForm()
      return
    }

    const { data, error: insertError } = await supabase
      .from('resources')
      .insert({ ...payload, org_id: orgId, unit_id: unitId })
      .select()
      .single()

    setLoading(false)

    if (insertError || !data) {
      setError('Não foi possível criar o recurso.')
      return
    }

    setResources((prev) => [data as Resource, ...prev])
    resetForm()
  }

  async function handleToggleActive(resource: Resource) {
    const supabase = createClient()
    const { data, error: toggleError } = await supabase
      .from('resources')
      .update({ is_active: !resource.is_active })
      .eq('id', resource.id)
      .select()
      .single()

    if (toggleError || !data) return
    setResources((prev) => prev.map((r) => (r.id === resource.id ? (data as Resource) : r)))
  }

  async function handleDelete(resource: Resource) {
    if (!window.confirm(`Excluir o recurso "${resource.name}"?`)) return
    const supabase = createClient()
    const { error: deleteError } = await supabase.from('resources').delete().eq('id', resource.id)
    if (deleteError) return
    setResources((prev) => prev.filter((r) => r.id !== resource.id))
    if (editingId === resource.id) resetForm()
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={handleSubmit}>
        <FormSection title={editingId ? 'Editar recurso' : 'Novo recurso'}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="resourceName">Nome *</Label>
              <Input
                id="resourceName"
                required
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Sala 1"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="resourceType">Tipo</Label>
              <Select
                id="resourceType"
                value={form.type}
                onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as ResourceType }))}
              >
                <option value="room">Sala</option>
                <option value="equipment">Equipamento</option>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="resourceCapacity">Capacidade</Label>
              <Input
                id="resourceCapacity"
                type="number"
                min={1}
                value={form.capacity}
                onChange={(e) => setForm((f) => ({ ...f, capacity: e.target.value }))}
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
              {loading ? 'Salvando...' : editingId ? 'Salvar alterações' : 'Adicionar recurso'}
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

      {resources.length > 0 && (
        <div className="overflow-hidden rounded-2xl bg-[#141a2b]" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.06)' }}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <TableShell>
                <Th>Nome</Th>
                <Th>Tipo</Th>
                <Th>Capacidade</Th>
                <Th>Status</Th>
                <Th>Ações</Th>
              </TableShell>
              <tbody>
                {resources.map((resource) => (
                  <Tr key={resource.id}>
                    <Td className="font-semibold text-white">{resource.name}</Td>
                    <Td className="text-slate-400">{TYPE_LABEL[resource.type]}</Td>
                    <Td className="text-slate-400">{resource.capacity}</Td>
                    <Td>
                      <button type="button" onClick={() => handleToggleActive(resource)}>
                        <StatusPill variant={resource.is_active ? 'green' : 'slate'}>
                          {resource.is_active ? 'Ativo' : 'Inativo'}
                        </StatusPill>
                      </button>
                    </Td>
                    <Td>
                      <div className="flex gap-3 text-xs font-semibold">
                        <button type="button" className="text-cyan-400 hover:text-cyan-300" onClick={() => handleEdit(resource)}>
                          Editar
                        </button>
                        <button type="button" className="text-red-400 hover:text-red-300" onClick={() => handleDelete(resource)}>
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
