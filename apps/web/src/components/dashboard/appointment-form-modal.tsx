'use client'

import { useEffect, useState, type ChangeEvent } from 'react'
import { ClipboardList, FileText, Sparkles, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { getAvailableSlots, zonedTimeToUtc, type AvailableSlot, type SlotEngineAppointment } from '@/lib/slot-engine'
import { addDays } from '@/lib/calendar-dates'
import { buildRecurringOccurrences, WEEKDAY_ORDER, type RecurrenceType } from '@/lib/scheduling/recurrence'
import type { ServiceRecurrence } from '@/lib/scheduling/service-recurrence'
import { isExtractableAttachment } from '@/lib/service-orders/extraction'
import { Card, Input, Label, Select, Textarea } from '@/components/ui/dashboard-ui'
import type { SchedulingSettings, Service, Employee, Weekday, WeeklySchedule } from '@/lib/types'
import type { AppointmentWithRelations } from '@/components/dashboard/calendar-view'

const SERVICE_ORDER_FILE_MAX_BYTES = 15 * 1024 * 1024
const SERVICE_ORDER_ACCEPTED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']

const RECURRENCE_OPTIONS: { value: 'none' | RecurrenceType; label: string }[] = [
  { value: 'none', label: 'Não se repete' },
  { value: 'weekly', label: 'Toda semana' },
  { value: 'biweekly', label: 'A cada 15 dias' },
  { value: 'monthly', label: 'Todo mês' },
  { value: 'custom', label: 'Personalizado (2+ vezes por semana)' },
]

const WEEKDAY_LABEL: Record<Weekday, string> = {
  mon: 'Seg',
  tue: 'Ter',
  wed: 'Qua',
  thu: 'Qui',
  fri: 'Sex',
  sat: 'Sáb',
  sun: 'Dom',
}

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
  defaultRecurrence,
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
  /** pré-marca a recorrência (cliente cadastrado como recorrente, service_recurrence) */
  defaultRecurrence?: ServiceRecurrence
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
  const [recurrence, setRecurrence] = useState<'none' | RecurrenceType>(
    mode === 'create' && defaultRecurrence && defaultRecurrence.type !== 'once' ? defaultRecurrence.type : 'none'
  )
  const [recurrenceDays, setRecurrenceDays] = useState<Weekday[]>(
    defaultRecurrence?.type === 'custom' && defaultRecurrence.days ? defaultRecurrence.days : []
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Ordem de serviço anexável já na criação (não precisa mais esperar o
  // agendamento existir) — seção opcional/pulável, reaproveita a mesma
  // lógica de upload+extração do ServiceOrderAttachModal (edição de uma
  // ordem já anexada a um agendamento existente continua por lá).
  const [showServiceOrder, setShowServiceOrder] = useState(false)
  const [soFile, setSoFile] = useState<File | null>(null)
  const [soFileUrl, setSoFileUrl] = useState('')
  const [soFileName, setSoFileName] = useState('')
  const [soOrderNumber, setSoOrderNumber] = useState('')
  const [soSummaryPt, setSoSummaryPt] = useState('')
  const [soScopeEn, setSoScopeEn] = useState('')
  const [soClientPo, setSoClientPo] = useState('')
  const [soPriority, setSoPriority] = useState('')
  const [soOrderType, setSoOrderType] = useState('')
  const [soIvrPin, setSoIvrPin] = useState('')
  const [soLocationName, setSoLocationName] = useState('')
  const [soLocationPhone, setSoLocationPhone] = useState('')
  const [soIssuerName, setSoIssuerName] = useState('')
  const [soIssuerEmail, setSoIssuerEmail] = useState('')
  const [soUploading, setSoUploading] = useState(false)
  const [soExtracting, setSoExtracting] = useState(false)
  const [soExtractionFailed, setSoExtractionFailed] = useState(false)
  const [soError, setSoError] = useState<string | null>(null)

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

  function handleServiceOrderFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0]
    setSoError(null)
    if (!selected) {
      setSoFile(null)
      return
    }
    if (!SERVICE_ORDER_ACCEPTED_TYPES.includes(selected.type)) {
      setSoError('Envie um PDF ou uma imagem (JPG, PNG, WEBP).')
      return
    }
    if (selected.size > SERVICE_ORDER_FILE_MAX_BYTES) {
      setSoError('O arquivo deve ter no máximo 15MB.')
      return
    }
    setSoFile(selected)
  }

  /**
   * Sobe o arquivo pra um path "pending" (o agendamento ainda não
   * existe) e extrai os campos por IA — mesmo padrão do
   * ServiceOrderAttachModal, mas via rota de extração que não depende
   * de appointmentId. O arquivo permanece nesse path pra sempre; só a
   * URL pública é salva no agendamento quando o formulário é
   * submetido.
   */
  async function handleServiceOrderUploadAndExtract() {
    if (!soFile) return
    setSoError(null)
    setSoExtractionFailed(false)
    setSoUploading(true)
    const supabase = createClient()
    const path = `${unitId}/pending-${crypto.randomUUID()}/${soFile.name}`
    const { error: uploadError } = await supabase.storage
      .from('service-orders')
      .upload(path, soFile, { contentType: soFile.type, upsert: true })
    setSoUploading(false)
    if (uploadError) {
      setSoError('Não foi possível enviar o arquivo.')
      return
    }
    const { data: publicUrlData } = supabase.storage.from('service-orders').getPublicUrl(path)
    setSoFileUrl(publicUrlData.publicUrl)
    setSoFileName(soFile.name)

    if (!isExtractableAttachment(soFile.name)) {
      return
    }

    setSoExtracting(true)
    try {
      const response = await fetch(`/api/units/${unitId}/service-order/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileUrl: publicUrlData.publicUrl, fileName: soFile.name }),
      })
      if (response.ok) {
        const data = (await response.json()) as {
          summaryPt: string | null
          scopeEn: string | null
          address: string | null
          orderNumber: string | null
          clientPo: string | null
          priority: string | null
          orderType: string | null
          ivrPin: string | null
          locationName: string | null
          locationPhone: string | null
          issuerName: string | null
          issuerEmail: string | null
          failed: boolean
        }
        if (data.summaryPt) setSoSummaryPt(data.summaryPt)
        if (data.scopeEn) setSoScopeEn(data.scopeEn)
        if (data.orderNumber) setSoOrderNumber(data.orderNumber)
        // Só preenche endereço do atendimento se ainda estiver vazio — nunca sobrescreve o que já foi digitado.
        if (data.address && !address.trim()) setAddress(data.address)
        if (data.clientPo) setSoClientPo(data.clientPo)
        if (data.priority) setSoPriority(data.priority)
        if (data.orderType) setSoOrderType(data.orderType)
        if (data.ivrPin) setSoIvrPin(data.ivrPin)
        if (data.locationName) setSoLocationName(data.locationName)
        if (data.locationPhone) setSoLocationPhone(data.locationPhone)
        if (data.issuerName) setSoIssuerName(data.issuerName)
        if (data.issuerEmail) setSoIssuerEmail(data.issuerEmail)
        setSoExtractionFailed(data.failed)
      } else {
        setSoExtractionFailed(true)
      }
    } catch {
      setSoExtractionFailed(true)
    } finally {
      setSoExtracting(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!selectedSlot) {
      setError('Escolha um horário livre.')
      return
    }
    if (mode === 'create' && recurrence === 'custom' && recurrenceDays.length === 0) {
      setError('Escolha pelo menos um dia da semana pra recorrência personalizada.')
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

    // Ordem de serviço anexada nesta tela (opcional): pertence só ao
    // PRIMEIRO atendimento da série, nunca a todas as ocorrências
    // recorrentes — é uma ordem específica de uma visita, não um
    // template repetido toda semana.
    const soFields = soFileUrl
      ? {
          service_order_file_url: soFileUrl,
          service_order_file_name: soFileName || null,
          service_order_number: soOrderNumber.trim() || null,
          service_order_summary_pt: soSummaryPt.trim() || null,
          service_order_scope_en: soScopeEn.trim() || null,
          service_order_client_po: soClientPo.trim() || null,
          service_order_priority: soPriority.trim() || null,
          service_order_order_type: soOrderType.trim() || null,
          service_order_ivr_pin: soIvrPin.trim() || null,
          service_order_location_name: soLocationName.trim() || null,
          service_order_location_phone: soLocationPhone.trim() || null,
          service_order_issuer_name: soIssuerName.trim() || null,
          service_order_issuer_email: soIssuerEmail.trim() || null,
        }
      : {}

    // Recorrência: gera o horizonte da série como agendamentos reais, todos
    // no mesmo grupo — agenda e financeiro são alimentados sem passo manual
    // (lembrete, "a caminho" e Concluir → service_records já valem pra cada
    // ocorrência). Só a disponibilidade da PRIMEIRA ocorrência é validada
    // pelo motor de slots; as seguintes assumem o mesmo horário.
    const firstOccurrence = { starts_at: selectedSlot.starts_at, ends_at: selectedSlot.ends_at }
    const occurrences =
      recurrence === 'none'
        ? [firstOccurrence]
        : buildRecurringOccurrences(firstOccurrence, timezone, recurrence, recurrenceDays)
    const recurrenceFields =
      recurrence === 'none'
        ? {}
        : {
            recurrence,
            recurrence_group_id: crypto.randomUUID(),
            recurrence_days: recurrence === 'custom' ? recurrenceDays : null,
          }

    const { data: insertedAppointments, error: insertError } = await supabase
      .from('appointments')
      .insert(occurrences.map((occ, i) => ({ ...baseRow, ...recurrenceFields, ...occ, ...(i === 0 ? soFields : {}) })))
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
              <div
                className="flex flex-col gap-2.5 rounded-xl px-3.5 py-3"
                style={{ background: 'rgba(129,140,248,0.06)', border: '1px solid rgba(129,140,248,0.2)' }}
              >
                <div className="flex flex-col gap-1.5">
                  <Label>Recorrência</Label>
                  <Select value={recurrence} onChange={(e) => setRecurrence(e.target.value as 'none' | RecurrenceType)}>
                    {RECURRENCE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </Select>
                </div>

                {recurrence === 'custom' && (
                  <div className="flex flex-wrap gap-1.5">
                    {WEEKDAY_ORDER.map((day) => (
                      <button
                        key={day}
                        type="button"
                        onClick={() =>
                          setRecurrenceDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]))
                        }
                        className="rounded-lg px-2.5 py-1 text-xs font-bold transition-colors"
                        style={
                          recurrenceDays.includes(day)
                            ? { background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)', color: 'white' }
                            : { background: 'rgba(255,255,255,0.05)', color: '#cbd5e1', border: '1px solid rgba(255,255,255,0.08)' }
                        }
                      >
                        {WEEKDAY_LABEL[day]}
                      </button>
                    ))}
                  </div>
                )}

                {recurrence !== 'none' && (
                  <p className="text-xs text-slate-400">
                    Já deixamos os próximos atendimentos agendados — e a série se estende sozinha a cada
                    serviço concluído. Cancele quando quiser.
                  </p>
                )}
              </div>
            )}

            {mode === 'create' && !showServiceOrder && (
              <button
                type="button"
                onClick={() => setShowServiceOrder(true)}
                className="flex w-fit items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold text-indigo-300 transition-colors hover:text-indigo-200"
                style={{ background: 'rgba(129,140,248,0.08)', border: '1px solid rgba(129,140,248,0.25)' }}
              >
                <ClipboardList size={13} />
                Anexar ordem de serviço
              </button>
            )}

            {mode === 'create' && showServiceOrder && (
              <div
                className="flex flex-col gap-3 rounded-xl px-3.5 py-3"
                style={{ background: 'rgba(129,140,248,0.06)', border: '1px solid rgba(129,140,248,0.2)' }}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[11px] font-black uppercase tracking-wider text-indigo-300">Ordem de serviço (opcional)</span>
                  <button
                    type="button"
                    onClick={() => setShowServiceOrder(false)}
                    className="text-xs font-bold text-slate-400 hover:text-slate-300"
                  >
                    Ocultar
                  </button>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label>Arquivo da ordem (PDF ou foto)</Label>
                  {soFileUrl && !soFile && (
                    <div className="flex items-center gap-2">
                      <a
                        href={soFileUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1.5 text-xs font-bold text-cyan-400 hover:text-cyan-300"
                      >
                        <FileText size={13} />
                        {soFileName || 'Arquivo enviado'}
                      </a>
                    </div>
                  )}
                  <input
                    type="file"
                    accept="application/pdf,image/jpeg,image/png,image/webp"
                    onChange={handleServiceOrderFileChange}
                    className="text-sm text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-1.5 file:text-xs file:font-bold file:text-slate-200"
                  />
                  {soFile && (
                    <button
                      type="button"
                      disabled={soUploading || soExtracting}
                      onClick={handleServiceOrderUploadAndExtract}
                      className="flex w-fit items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold text-white transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
                      style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)' }}
                    >
                      <Sparkles size={13} />
                      {soUploading ? 'Enviando…' : soExtracting ? 'Lendo o documento…' : 'Enviar e preencher com IA'}
                    </button>
                  )}
                  {soExtractionFailed && (
                    <p className="text-xs font-semibold text-amber-400">
                      Não consegui ler o documento automaticamente. Preencha os campos abaixo manualmente.
                    </p>
                  )}
                  {soError && <p className="text-xs text-red-400">{soError}</p>}
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label>Número da ordem (Vendor PO #)</Label>
                  <Input value={soOrderNumber} onChange={(e) => setSoOrderNumber(e.target.value)} placeholder="Ex: 132617" />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label>Client PO #</Label>
                    <Input value={soClientPo} onChange={(e) => setSoClientPo(e.target.value)} placeholder="Opcional" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label>Prioridade</Label>
                    <Input value={soPriority} onChange={(e) => setSoPriority(e.target.value)} placeholder="Ex: Low" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label>Tipo da ordem</Label>
                    <Input value={soOrderType} onChange={(e) => setSoOrderType(e.target.value)} placeholder="Ex: Interior" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label>IVR Pin #</Label>
                    <Input value={soIvrPin} onChange={(e) => setSoIvrPin(e.target.value)} placeholder="Opcional" />
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label>Nome/código do local</Label>
                  <Input
                    value={soLocationName}
                    onChange={(e) => setSoLocationName(e.target.value)}
                    placeholder="Ex: PB - Tanger - Loc # 6800"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label>Telefone do local</Label>
                  <Input value={soLocationPhone} onChange={(e) => setSoLocationPhone(e.target.value)} placeholder="Opcional" />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label>Nome de quem emitiu a ordem</Label>
                    <Input value={soIssuerName} onChange={(e) => setSoIssuerName(e.target.value)} placeholder="Ex: Taina Dias" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label>E-mail de quem emitiu</Label>
                    <Input value={soIssuerEmail} onChange={(e) => setSoIssuerEmail(e.target.value)} placeholder="nome@empresa.com" />
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label>Escopo do trabalho (em português — uso interno do técnico)</Label>
                  <Textarea
                    rows={4}
                    value={soSummaryPt}
                    onChange={(e) => setSoSummaryPt(e.target.value)}
                    placeholder="Texto completo do que precisa ser feito — aparece pro técnico no Portal do Funcionário, não vai pro PDF."
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label>Scope Of Work (em inglês — vai pro PDF do cliente)</Label>
                  <Textarea
                    rows={4}
                    value={soScopeEn}
                    onChange={(e) => setSoScopeEn(e.target.value)}
                    placeholder="Texto completo do escopo em inglês — vai pro PDF final da ordem exatamente como escrito aqui."
                  />
                </div>
              </div>
            )}

            {mode === 'reschedule' && appointment?.recurrence && (
              <p className="text-xs text-slate-500">
                Este atendimento faz parte de uma série recorrente — só esta ocorrência será alterada.
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
