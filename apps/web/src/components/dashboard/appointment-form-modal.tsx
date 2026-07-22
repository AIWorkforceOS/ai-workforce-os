'use client'

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { getAvailableSlots, zonedTimeToUtc, type AvailableSlot, type SlotEngineAppointment } from '@/lib/slot-engine'
import { addDays } from '@/lib/calendar-dates'
import { buildWeeklyOccurrences, RECURRENCE_WEEKS_AHEAD } from '@/lib/scheduling/recurrence'
import { Card, Input, Label, Select, Textarea } from '@/components/ui/dashboard-ui'
import type { SchedulingSettings, Service, Employee, WeeklySchedule } from '@/lib/types'
import type { AppointmentWithRelations } from '@/components/dashboard/calendar-view'

type CustomerOption = { id: string; name: string; phone: string | null; address?: string | null }

/** Fire-and-forget: a mutação em `appointments` já foi gravada, o aviso automático nunca deve bloquear a UI nem virar erro pro usuário (falhas ficam em system_events). */
function notifyAppointment(unitId: string, appointmentId: string, event: 'booked' | 'rescheduled') {
  void fetch(`/api/units/${unitId}/appointments/${appointmentId}/notify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event }),
  }).catch(() => {})
}

export function AppointmentFormModal({
  unitId,
  orgId,
  timezone,
  businessHours,
  schedulingSettings,
  services,
  employees,
  mode,
  initialDate,
  appointment,
  initialCustomer,
  defaultPrice,
  defaultWeekly,
  onClose,
  onSaved,
}: {
  unitId: string
  orgId: string
  timezone: string
  businessHours: WeeklySchedule
  schedulingSettings: SchedulingSettings
  services: Service[]
  employees: Employee[]
  mode: 'create' | 'reschedule'
  initialDate: string
  appointment?: AppointmentWithRelations
  /** cliente pré-selecionado (agendamento a partir da ficha do cliente) */
  initialCustomer?: CustomerOption
  /** valor combinado padrão (ex.: custom_fields.service_value do cliente) — sobrepõe o preço do serviço */
  defaultPrice?: number | null
  /** pré-marca "repetir toda semana" (cliente cadastrado como recorrente) */
  defaultWeekly?: boolean
  onClose: () => void
  onSaved: () => void | Promise<void>
}) {
  const [serviceId, setServiceId] = useState(appointment?.service_id ?? services[0]?.id ?? '')
  const [employeeId, setEmployeeId] = useState(appointment?.employee_id ?? employees[0]?.id ?? '')
  const [date, setDate] = useState(initialDate)
  const [slots, setSlots] = useState<AvailableSlot[]>([])
  const [selectedSlot, setSelectedSlot] = useState<AvailableSlot | null>(null)
  const [loadingSlots, setLoadingSlots] = useState(false)

  const [customerQuery, setCustomerQuery] = useState('')
  const [customerResults, setCustomerResults] = useState<CustomerOption[]>([])
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerOption | null>(
    appointment?.customer
      ? { id: appointment.customer.id, name: appointment.customer.name, phone: appointment.customer.phone }
      : initialCustomer ?? null
  )
  const [showNewCustomer, setShowNewCustomer] = useState(false)
  const [newCustomerName, setNewCustomerName] = useState('')
  const [newCustomerPhone, setNewCustomerPhone] = useState('')
  const [newCustomerAddress, setNewCustomerAddress] = useState('')

  const [address, setAddress] = useState(appointment?.address ?? initialCustomer?.address ?? '')
  const [notes, setNotes] = useState(appointment?.notes ?? '')
  // Valor combinado deste atendimento: custom_fields.price sobrepõe services.price
  // no "Concluir" → service_records (financeiro). Vazio = usa o preço do serviço.
  const existingPrice = Number((appointment?.custom_fields as { price?: unknown } | undefined)?.price)
  const [price, setPrice] = useState<string>(
    Number.isFinite(existingPrice) && existingPrice > 0
      ? String(existingPrice)
      : defaultPrice && defaultPrice > 0
        ? String(defaultPrice)
        : ''
  )
  const [weekly, setWeekly] = useState(defaultWeekly ?? false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [addingToWaitlist, setAddingToWaitlist] = useState(false)
  const [waitlistAdded, setWaitlistAdded] = useState(false)
  const [waitlistError, setWaitlistError] = useState<string | null>(null)

  useEffect(() => {
    if (!serviceId || !employeeId || !date) {
      setSlots([])
      return
    }
    let cancelled = false

    async function loadSlots() {
      setLoadingSlots(true)
      setWaitlistAdded(false)
      setWaitlistError(null)
      const supabase = createClient()
      const dayStartUtc = zonedTimeToUtc(date, '00:00', timezone).toISOString()
      const dayEndUtc = zonedTimeToUtc(addDays(date, 1), '00:00', timezone).toISOString()
      const { data } = await supabase
        .from('appointments')
        .select('id, starts_at, ends_at, status')
        .eq('unit_id', unitId)
        .eq('employee_id', employeeId)
        .gte('starts_at', dayStartUtc)
        .lt('starts_at', dayEndUtc)
      if (cancelled) return

      const service = services.find((s) => s.id === serviceId)
      const employee = employees.find((e) => e.id === employeeId)
      if (!service) {
        setSlots([])
        setLoadingSlots(false)
        return
      }

      const existingAppointments = ((data ?? []) as (SlotEngineAppointment & { id: string })[]).filter(
        (a) => mode !== 'reschedule' || a.id !== appointment?.id
      )

      const result = getAvailableSlots({
        date,
        timezone,
        businessHours,
        schedulingSettings,
        service,
        employeeAvailability: employee?.availability,
        existingAppointments,
      })
      setSlots(result)
      setSelectedSlot(null)
      setLoadingSlots(false)
    }

    loadSlots()
    return () => {
      cancelled = true
    }
  }, [serviceId, employeeId, date])

  useEffect(() => {
    if (mode !== 'create') return
    if (customerQuery.trim().length < 2) {
      setCustomerResults([])
      return
    }
    const handle = setTimeout(async () => {
      const supabase = createClient()
      const { data } = await supabase
        .from('customers')
        .select('id, name, phone, address')
        .eq('unit_id', unitId)
        .ilike('name', `%${customerQuery.trim()}%`)
        .limit(8)
      setCustomerResults((data ?? []) as CustomerOption[])
    }, 300)
    return () => clearTimeout(handle)
  }, [customerQuery, mode, unitId])

  /** Resolve o cliente selecionado (ou cadastra o novo, se aberto o formulário inline). Reusado pela criação normal de agendamento e pelo fallback de lista de espera. */
  async function resolveCustomerId(
    supabase: ReturnType<typeof createClient>,
    reportError: (message: string) => void
  ): Promise<string | null> {
    if (selectedCustomer) return selectedCustomer.id

    if (showNewCustomer) {
      if (!newCustomerName.trim()) {
        reportError('Informe o nome do cliente.')
        return null
      }
      const { data: newCustomer, error: customerError } = await supabase
        .from('customers')
        .insert({
          org_id: orgId,
          unit_id: unitId,
          name: newCustomerName.trim(),
          phone: newCustomerPhone.trim() || null,
          address: newCustomerAddress.trim() || null,
          source: 'manual',
        })
        .select('id, name, phone')
        .single()
      if (customerError || !newCustomer) {
        reportError('Não foi possível cadastrar o cliente.')
        return null
      }
      return (newCustomer as CustomerOption).id
    }

    reportError('Escolha ou cadastre um cliente.')
    return null
  }

  /** Fallback quando a busca de slots não encontra vaga: registra a preferência do cliente em waitlist_entries, sem matching automático — um humano converte manualmente depois (tela /agenda/waitlist). */
  async function handleAddToWaitlist() {
    setWaitlistError(null)
    setAddingToWaitlist(true)
    const supabase = createClient()

    const customerId = await resolveCustomerId(supabase, setWaitlistError)
    if (!customerId) {
      setAddingToWaitlist(false)
      return
    }

    const { error: insertError } = await supabase.from('waitlist_entries').insert({
      org_id: orgId,
      unit_id: unitId,
      customer_id: customerId,
      service_id: serviceId || null,
      preferred_starts_at: zonedTimeToUtc(date, '00:00', timezone).toISOString(),
      preferred_notes: notes.trim() || null,
    })
    setAddingToWaitlist(false)
    if (insertError) {
      setWaitlistError('Não foi possível adicionar à lista de espera.')
      return
    }
    setWaitlistAdded(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!selectedSlot) {
      setError('Escolha um horário livre.')
      return
    }

    const supabase = createClient()
    setSaving(true)

    const priceValue = Number(price)
    const priceCustomFields = Number.isFinite(priceValue) && priceValue > 0 ? { price: priceValue } : {}

    if (mode === 'reschedule') {
      // Preserva as demais chaves de custom_fields; só o valor combinado muda aqui.
      const otherCustomFields = { ...(appointment!.custom_fields ?? {}) } as Record<string, unknown>
      delete otherCustomFields.price
      const { error: updateError } = await supabase
        .from('appointments')
        .update({
          service_id: serviceId,
          employee_id: employeeId,
          starts_at: selectedSlot.starts_at,
          ends_at: selectedSlot.ends_at,
          address: address.trim() || null,
          notes: notes.trim() || null,
          custom_fields: { ...otherCustomFields, ...priceCustomFields },
          // reseta o carimbo de aviso: um reagendamento é um evento novo,
          // que merece seu próprio aviso automático (ver rescheduled_notified_at)
          rescheduled_notified_at: null,
        })
        .eq('id', appointment!.id)
      setSaving(false)
      if (updateError) {
        setError('Não foi possível reagendar. O horário pode ter sido ocupado.')
        return
      }
      notifyAppointment(unitId, appointment!.id, 'rescheduled')
      await onSaved()
      onClose()
      return
    }

    const customerId = await resolveCustomerId(supabase, setError)
    if (!customerId) {
      setSaving(false)
      return
    }

    const baseRow = {
      org_id: orgId,
      unit_id: unitId,
      customer_id: customerId,
      service_id: serviceId,
      employee_id: employeeId,
      address: address.trim() || null,
      notes: notes.trim() || null,
      custom_fields: priceCustomFields,
    }

    // Recorrência semanal: gera as próximas semanas como agendamentos reais,
    // todos no mesmo grupo — agenda e financeiro são alimentados sem passo
    // manual (lembrete, "a caminho" e Concluir → service_records já valem
    // pra cada ocorrência). Só a disponibilidade da PRIMEIRA semana é
    // validada pelo motor de slots; as seguintes assumem o mesmo horário.
    const occurrences = weekly
      ? buildWeeklyOccurrences({ starts_at: selectedSlot.starts_at, ends_at: selectedSlot.ends_at }, timezone)
      : [{ starts_at: selectedSlot.starts_at, ends_at: selectedSlot.ends_at }]
    const recurrenceFields = weekly
      ? { recurrence: 'weekly', recurrence_group_id: crypto.randomUUID() }
      : {}

    const { data: insertedAppointments, error: insertError } = await supabase
      .from('appointments')
      .insert(occurrences.map((occ) => ({ ...baseRow, ...recurrenceFields, ...occ })))
      .select('id, starts_at')
    setSaving(false)
    if (insertError) {
      setError('Não foi possível criar o agendamento. O horário pode ter sido ocupado.')
      return
    }
    // Aviso automático só da primeira ocorrência — os lembretes de cada
    // semana seguinte já são cobertos pelo cron de lembretes.
    const firstId = ((insertedAppointments ?? []) as { id: string; starts_at: string }[])
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0]?.id
    if (firstId) notifyAppointment(unitId, firstId, 'booked')
    await onSaved()
    onClose()
  }

  function formatSlotTime(iso: string): string {
    return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: timezone })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-4"
      style={{ background: 'rgba(0,0,0,0.7)' }}
      onClick={onClose}
    >
      <Card className="w-full max-w-lg p-6">
        <div onClick={(e) => e.stopPropagation()} className="max-h-[85vh] overflow-y-auto">
          <div className="mb-4 flex items-start justify-between gap-3">
            <h2 className="text-sm font-black text-white">
              {mode === 'create' ? 'Novo agendamento' : 'Reagendar atendimento'}
            </h2>
            <button type="button" onClick={onClose} className="text-slate-500 hover:text-slate-300">
              <X size={16} />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label>Serviço *</Label>
                <Select value={serviceId} onChange={(e) => setServiceId(e.target.value)} required>
                  {services.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.duration_minutes}min)
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Profissional *</Label>
                <Select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} required>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.name}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Data *</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Horário *</Label>
              {loadingSlots ? (
                <p className="text-sm text-slate-500">Calculando horários livres…</p>
              ) : slots.length === 0 ? (
                <div className="flex flex-col items-start gap-2">
                  <p className="text-sm text-slate-500">Nenhum horário livre neste dia para este serviço/profissional.</p>
                  {waitlistAdded ? (
                    <p className="text-sm font-semibold text-emerald-400">Adicionado à lista de espera.</p>
                  ) : (
                    <button
                      type="button"
                      disabled={addingToWaitlist}
                      onClick={handleAddToWaitlist}
                      className="rounded-lg px-3 py-1.5 text-xs font-bold text-cyan-400 transition-colors hover:text-cyan-300 disabled:opacity-40"
                      style={{ border: '1px solid rgba(6,182,212,0.3)' }}
                    >
                      {addingToWaitlist ? 'Adicionando…' : 'Adicionar à lista de espera'}
                    </button>
                  )}
                  {waitlistError && <p className="text-sm text-red-400">{waitlistError}</p>}
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {slots.map((slot) => (
                    <button
                      key={slot.starts_at}
                      type="button"
                      onClick={() => setSelectedSlot(slot)}
                      className="rounded-lg px-3 py-1.5 text-xs font-bold transition-colors"
                      style={
                        selectedSlot?.starts_at === slot.starts_at
                          ? { background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)', color: 'white' }
                          : { background: 'rgba(255,255,255,0.05)', color: '#cbd5e1', border: '1px solid rgba(255,255,255,0.08)' }
                      }
                    >
                      {formatSlotTime(slot.starts_at)}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {mode === 'create' && (
              <div className="flex flex-col gap-1.5">
                <Label>Cliente *</Label>
                {selectedCustomer ? (
                  <div
                    className="flex items-center justify-between rounded-xl px-3.5 py-2.5 text-sm text-white"
                    style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
                  >
                    <span>
                      {selectedCustomer.name}
                      {selectedCustomer.phone ? ` · ${selectedCustomer.phone}` : ''}
                    </span>
                    <button
                      type="button"
                      className="text-xs font-bold text-cyan-400 hover:text-cyan-300"
                      onClick={() => setSelectedCustomer(null)}
                    >
                      Trocar
                    </button>
                  </div>
                ) : showNewCustomer ? (
                  <div className="flex flex-col gap-2">
                    <Input
                      value={newCustomerName}
                      onChange={(e) => setNewCustomerName(e.target.value)}
                      placeholder="Nome do cliente"
                    />
                    <Input
                      value={newCustomerPhone}
                      onChange={(e) => setNewCustomerPhone(e.target.value)}
                      placeholder="Telefone (opcional)"
                    />
                    <Input
                      value={newCustomerAddress}
                      onChange={(e) => {
                        setNewCustomerAddress(e.target.value)
                        setAddress(e.target.value)
                      }}
                      placeholder="Endereço (opcional)"
                    />
                    <button
                      type="button"
                      className="self-start text-xs font-bold text-slate-400 hover:text-slate-300"
                      onClick={() => setShowNewCustomer(false)}
                    >
                      Buscar cliente existente
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    <Input
                      value={customerQuery}
                      onChange={(e) => setCustomerQuery(e.target.value)}
                      placeholder="Buscar cliente por nome…"
                    />
                    {customerResults.length > 0 && (
                      <div className="flex flex-col gap-1 rounded-xl p-1" style={{ background: 'rgba(255,255,255,0.03)' }}>
                        {customerResults.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            className="rounded-lg px-2.5 py-1.5 text-left text-sm text-white hover:bg-white/5"
                            onClick={() => {
                              setSelectedCustomer(c)
                              setCustomerResults([])
                              setCustomerQuery('')
                              // endereço cadastrado do cliente vira o padrão do atendimento, sem sobrescrever o que já foi digitado
                              if (c.address && !address.trim()) setAddress(c.address)
                            }}
                          >
                            {c.name}
                            {c.phone ? ` · ${c.phone}` : ''}
                          </button>
                        ))}
                      </div>
                    )}
                    <button
                      type="button"
                      className="self-start text-xs font-bold text-cyan-400 hover:text-cyan-300"
                      onClick={() => setShowNewCustomer(true)}
                    >
                      + Cadastrar novo cliente
                    </button>
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <Label>Endereço do atendimento</Label>
              <Input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Onde o serviço será prestado (opcional)"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Valor combinado</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder={
                  services.find((s) => s.id === serviceId)?.price
                    ? `Vazio = preço do serviço (${services.find((s) => s.id === serviceId)!.price})`
                    : 'Opcional — usado no financeiro ao concluir'
                }
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Descrição / observações</Label>
              <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional" />
            </div>

            {mode === 'create' && (
              <label
                className="flex cursor-pointer items-start gap-2.5 rounded-xl px-3.5 py-3"
                style={{ background: 'rgba(129,140,248,0.06)', border: '1px solid rgba(129,140,248,0.2)' }}
              >
                <input
                  type="checkbox"
                  checked={weekly}
                  onChange={(e) => setWeekly(e.target.checked)}
                  className="mt-0.5 accent-cyan-500"
                />
                <span className="text-sm text-slate-200">
                  <span className="font-bold">Repetir toda semana neste horário</span>
                  <span className="block text-xs text-slate-400">
                    Já deixamos as próximas {RECURRENCE_WEEKS_AHEAD} semanas agendadas — e a série se
                    estende sozinha a cada serviço concluído. Cancele quando quiser.
                  </span>
                </span>
              </label>
            )}

            {mode === 'reschedule' && appointment?.recurrence === 'weekly' && (
              <p className="text-xs text-slate-500">
                Este atendimento faz parte de uma série semanal — só esta ocorrência será alterada.
              </p>
            )}

            {error && <p className="text-sm text-red-400">{error}</p>}

            <div className="flex gap-3">
              <button
                type="submit"
                disabled={saving || !selectedSlot}
                className="flex-1 rounded-xl px-4 py-2.5 text-sm font-bold text-white transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)', boxShadow: '0 4px 14px rgba(6,182,212,0.3)' }}
              >
                {saving ? 'Salvando…' : mode === 'create' ? 'Confirmar agendamento' : 'Salvar novo horário'}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl px-4 py-2.5 text-sm text-slate-300 hover:bg-white/5"
                style={{ border: '1px solid rgba(255,255,255,0.08)' }}
              >
                Cancelar
              </button>
            </div>
          </form>
        </div>
      </Card>
    </div>
  )
}
