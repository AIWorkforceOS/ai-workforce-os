'use client'

import { useState } from 'react'
import { CalendarPlus, MapPin } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { localDateString, zonedTimeToUtc } from '@/lib/slot-engine'
import { addDays } from '@/lib/calendar-dates'
import { nextOccurrenceAfter, RECURRENCE_PILL_LABEL, type RecurrenceType } from '@/lib/scheduling/recurrence'
import { AppointmentFormModal } from '@/components/dashboard/appointment-form-modal'
import { Card, StatusPill, type BadgeVariant } from '@/components/ui/dashboard-ui'
import { computeSuggestedPay } from '@/lib/service-pay'
import type {
  Appointment,
  AppointmentStatus,
  Customer,
  Employee,
  SchedulingSettings,
  Service,
  WeeklySchedule,
} from '@/lib/types'

export type AppointmentWithRelations = Appointment & {
  customer: Pick<Customer, 'id' | 'name' | 'phone'> | null
  service: Pick<Service, 'id' | 'name'> | null
  employee: Pick<Employee, 'id' | 'name'> | null
}

type ModalState =
  | { mode: 'create'; date: string }
  | { mode: 'reschedule'; appointment: AppointmentWithRelations }

const STATUS_VARIANT: Record<AppointmentStatus, BadgeVariant> = {
  scheduled: 'cyan',
  confirmed: 'blue',
  completed: 'green',
  cancelled: 'slate',
  no_show: 'red',
}

const STATUS_LABEL: Record<AppointmentStatus, string> = {
  scheduled: 'Agendado',
  confirmed: 'Confirmado',
  completed: 'Concluído',
  cancelled: 'Cancelado',
  no_show: 'Faltou',
}

const ACTIVE_STATUSES: AppointmentStatus[] = ['scheduled', 'confirmed']

/** Fire-and-forget: a mutação em `appointments` já foi gravada, o aviso automático nunca deve bloquear a UI nem virar erro pro usuário (falhas ficam em system_events). */
function notifyAppointment(unitId: string, appointmentId: string, event: 'cancelled' | 'no_show') {
  void fetch(`/api/units/${unitId}/appointments/${appointmentId}/notify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event }),
  }).catch(() => {})
}

/** "A caminho" é diferente dos demais avisos: é ação humana deliberada, então aqui a resposta é aguardada para dar feedback visual (carimbo on_my_way_sent_at) na hora. */
async function notifyOnMyWay(unitId: string, appointmentId: string): Promise<void> {
  await fetch(`/api/units/${unitId}/appointments/${appointmentId}/notify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event: 'on_my_way' }),
  })
}

/** Formata 'YYYY-MM-DD' como cabeçalho do dia, sem depender do fuso local do processo. */
function formatDayHeader(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number) as [number, number, number]
  const dt = new Date(Date.UTC(year, month - 1, day))
  const label = dt.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', timeZone: 'UTC' })
  return label.charAt(0).toUpperCase() + label.slice(1)
}

function formatTimeRange(startsAt: string, endsAt: string, timezone: string): string {
  const fmt = (iso: string) =>
    new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: timezone })
  return `${fmt(startsAt)}–${fmt(endsAt)}`
}

export function CalendarView({
  unitId,
  orgId,
  timezone,
  businessHours,
  schedulingSettings,
  services,
  employees,
  weekDates,
  todayLocal,
  initialAppointments,
}: {
  unitId: string
  orgId: string | null
  timezone: string
  businessHours: WeeklySchedule
  schedulingSettings: SchedulingSettings
  services: Service[]
  employees: Employee[]
  weekDates: string[]
  todayLocal: string
  initialAppointments: AppointmentWithRelations[]
}) {
  const [appointments, setAppointments] = useState<AppointmentWithRelations[]>(initialAppointments)
  const [modal, setModal] = useState<ModalState | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [rowError, setRowError] = useState<string | null>(null)

  const canBook = !!orgId && services.length > 0 && employees.length > 0

  async function reload() {
    const supabase = createClient()
    const rangeStartUtc = zonedTimeToUtc(weekDates[0]!, '00:00', timezone).toISOString()
    const rangeEndUtc = zonedTimeToUtc(addDays(weekDates[weekDates.length - 1]!, 1), '00:00', timezone).toISOString()
    const { data } = await supabase
      .from('appointments')
      .select('*, customer:customers(id,name,phone), service:services(id,name), employee:employees(id,name)')
      .eq('unit_id', unitId)
      .gte('starts_at', rangeStartUtc)
      .lt('starts_at', rangeEndUtc)
      .order('starts_at')
    setAppointments((data ?? []) as unknown as AppointmentWithRelations[])
  }

  async function handleCancel(appointment: AppointmentWithRelations) {
    if (!window.confirm(`Cancelar o agendamento de ${appointment.customer?.name ?? 'cliente'}?`)) return
    // Ocorrência de série semanal: oferece encerrar a recorrência inteira
    // (esta e todas as próximas semanas) em vez de só esta ocorrência.
    const cancelSeries =
      appointment.recurrence_group_id != null &&
      window.confirm('Este atendimento se repete toda semana. Cancelar também TODAS as próximas semanas?\n\nOK = encerrar a recorrência · Cancelar = só este atendimento')
    setRowError(null)
    setBusyId(appointment.id)
    const supabase = createClient()
    const cancelPayload = { status: 'cancelled', cancelled_at: new Date().toISOString() }
    const { error } = cancelSeries
      ? await supabase
          .from('appointments')
          .update(cancelPayload)
          .eq('recurrence_group_id', appointment.recurrence_group_id!)
          .gte('starts_at', appointment.starts_at)
          .in('status', ['scheduled', 'confirmed'])
      : await supabase.from('appointments').update(cancelPayload).eq('id', appointment.id)
    setBusyId(null)
    if (error) {
      setRowError('Não foi possível cancelar o agendamento.')
      return
    }
    notifyAppointment(unitId, appointment.id, 'cancelled')
    await reload()
  }

  async function handleNoShow(appointment: AppointmentWithRelations) {
    if (!window.confirm(`Marcar falta de ${appointment.customer?.name ?? 'cliente'}?`)) return
    setRowError(null)
    setBusyId(appointment.id)
    const supabase = createClient()
    const { error } = await supabase.from('appointments').update({ status: 'no_show' }).eq('id', appointment.id)
    setBusyId(null)
    if (error) {
      setRowError('Não foi possível marcar falta.')
      return
    }
    notifyAppointment(unitId, appointment.id, 'no_show')
    await reload()
  }

  /**
   * Concluir = o serviço aconteceu. Além do status, lança o registro em
   * service_records (valor cobrado = preço do serviço; valor a pagar =
   * default do profissional) — a base da folha operacional na tela
   * Operação. O índice único por appointment_id garante que concluir
   * duas vezes nunca duplica o lançamento.
   */
  async function handleComplete(appointment: AppointmentWithRelations) {
    if (!window.confirm(`Concluir o atendimento de ${appointment.customer?.name ?? 'cliente'}? O serviço será lançado na Operação.`)) return
    setRowError(null)
    setBusyId(appointment.id)
    const supabase = createClient()
    const { error } = await supabase.from('appointments').update({ status: 'completed' }).eq('id', appointment.id)
    if (error) {
      setBusyId(null)
      setRowError('Não foi possível concluir o atendimento.')
      return
    }

    if (orgId) {
      const service = services.find((s) => s.id === appointment.service_id) ?? null
      const employee = employees.find((e) => e.id === appointment.employee_id) ?? null
      // Valor combinado do atendimento (custom_fields.price) sobrepõe o preço
      // de tabela do serviço — é o que vale pro financeiro.
      const customPrice = Number((appointment.custom_fields as { price?: unknown } | null)?.price)
      const amountCharged = Number.isFinite(customPrice) && customPrice > 0 ? customPrice : service?.price ?? null
      const durationMinutes = Math.round(
        (new Date(appointment.ends_at).getTime() - new Date(appointment.starts_at).getTime()) / 60000
      )
      // Falha aqui não desfaz a conclusão: o registro pode ser lançado manualmente na Operação
      // (e o caso esperado de erro é o índice único, quando o registro já existe).
      await supabase.from('service_records').insert({
        org_id: orgId,
        unit_id: unitId,
        appointment_id: appointment.id,
        employee_id: appointment.employee_id,
        customer_id: appointment.customer_id,
        service_id: appointment.service_id,
        service_date: localDateString(new Date(appointment.starts_at), timezone),
        amount_charged: amountCharged,
        amount_due: computeSuggestedPay({ employee, amountCharged, durationMinutes }),
      })

      // Série semanal em uso não acaba: cada conclusão pendura +1 semana no
      // fim da série (best-effort — se falhar, a série só para de crescer,
      // e as 12 semanas geradas na criação continuam valendo).
      if (appointment.recurrence_group_id) {
        const { data: lastRows } = await supabase
          .from('appointments')
          .select('starts_at, ends_at')
          .eq('recurrence_group_id', appointment.recurrence_group_id)
          .neq('status', 'cancelled')
          .order('starts_at', { ascending: false })
          .limit(1)
        const last = (lastRows ?? [])[0] as { starts_at: string; ends_at: string } | undefined
        if (last && appointment.recurrence) {
          const next = nextOccurrenceAfter(last, timezone, appointment.recurrence as RecurrenceType)
          await supabase.from('appointments').insert({
            org_id: orgId,
            unit_id: unitId,
            customer_id: appointment.customer_id,
            service_id: appointment.service_id,
            employee_id: appointment.employee_id,
            address: appointment.address,
            notes: appointment.notes,
            custom_fields: appointment.custom_fields ?? {},
            recurrence: appointment.recurrence,
            recurrence_group_id: appointment.recurrence_group_id,
            recurrence_days: appointment.recurrence_days,
            ...next,
          })
        }
      }
    }

    setBusyId(null)
    await reload()
  }

  async function handleOnMyWay(appointment: AppointmentWithRelations) {
    setRowError(null)
    setBusyId(appointment.id)
    try {
      await notifyOnMyWay(unitId, appointment.id)
    } catch {
      setRowError('Não foi possível enviar o aviso "a caminho".')
    }
    setBusyId(null)
    await reload()
  }

  const now = Date.now()

  return (
    <div className="flex flex-col gap-4">
      {rowError && <p className="text-sm text-red-400">{rowError}</p>}

      {weekDates.map((date) => {
        const dayAppointments = appointments
          .filter((a) => localDateString(new Date(a.starts_at), timezone) === date)
          .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
        const isToday = date === todayLocal

        return (
          <Card key={date} className="overflow-hidden">
            <div
              className="flex items-center justify-between px-5 py-3"
              style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
            >
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-white">{formatDayHeader(date)}</h2>
                {isToday && <StatusPill variant="cyan">Hoje</StatusPill>}
              </div>
              <button
                type="button"
                disabled={!canBook}
                onClick={() => setModal({ mode: 'create', date })}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold text-white transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-40"
                style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)' }}
              >
                <CalendarPlus size={13} />
                Agendar
              </button>
            </div>

            {dayAppointments.length === 0 ? (
              <p className="px-5 py-4 text-sm text-slate-500">Nenhum agendamento.</p>
            ) : (
              <div className="flex flex-col">
                {dayAppointments.map((appointment) => {
                  const isActive = ACTIVE_STATUSES.includes(appointment.status)
                  const isPast = new Date(appointment.starts_at).getTime() < now
                  return (
                    <div
                      key={appointment.id}
                      className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
                      style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}
                    >
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-white">
                            {formatTimeRange(appointment.starts_at, appointment.ends_at, timezone)}
                          </span>
                          <StatusPill variant={STATUS_VARIANT[appointment.status]}>
                            {STATUS_LABEL[appointment.status]}
                          </StatusPill>
                          {appointment.recurrence && (
                            <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: 'rgba(129,140,248,0.15)', color: '#a5b4fc' }}>
                              {RECURRENCE_PILL_LABEL[appointment.recurrence]}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-400">
                          {appointment.customer?.name ?? 'Cliente removido'}
                          {appointment.service?.name ? ` · ${appointment.service.name}` : ''}
                          {appointment.employee?.name ? ` · ${appointment.employee.name}` : ''}
                        </p>
                        {appointment.address && (
                          <p className="flex items-center gap-1 text-xs text-slate-500">
                            <MapPin size={11} />
                            {appointment.address}
                          </p>
                        )}
                      </div>

                      {isActive && (
                        <div className="flex flex-wrap gap-3 text-xs font-semibold">
                          {isToday &&
                            (appointment.on_my_way_sent_at ? (
                              <span className="text-emerald-400">A caminho avisado ✓</span>
                            ) : (
                              <button
                                type="button"
                                disabled={busyId === appointment.id}
                                className="text-emerald-400 hover:text-emerald-300 disabled:opacity-40"
                                onClick={() => handleOnMyWay(appointment)}
                              >
                                Avisar a caminho
                              </button>
                            ))}
                          <button
                            type="button"
                            disabled={busyId === appointment.id}
                            className="text-cyan-400 hover:text-cyan-300 disabled:opacity-40"
                            onClick={() => setModal({ mode: 'reschedule', appointment })}
                          >
                            Reagendar
                          </button>
                          {isPast && (
                            <>
                              <button
                                type="button"
                                disabled={busyId === appointment.id}
                                className="text-green-400 hover:text-green-300 disabled:opacity-40"
                                onClick={() => handleComplete(appointment)}
                              >
                                Concluir
                              </button>
                              <button
                                type="button"
                                disabled={busyId === appointment.id}
                                className="text-amber-400 hover:text-amber-300 disabled:opacity-40"
                                onClick={() => handleNoShow(appointment)}
                              >
                                Marcar falta
                              </button>
                            </>
                          )}
                          <button
                            type="button"
                            disabled={busyId === appointment.id}
                            className="text-red-400 hover:text-red-300 disabled:opacity-40"
                            onClick={() => handleCancel(appointment)}
                          >
                            Cancelar
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </Card>
        )
      })}

      {modal && (
        <AppointmentFormModal
          unitId={unitId}
          orgId={orgId!}
          timezone={timezone}
          businessHours={businessHours}
          schedulingSettings={schedulingSettings}
          services={services}
          employees={employees}
          mode={modal.mode}
          initialDate={modal.mode === 'create' ? modal.date : localDateString(new Date(modal.appointment.starts_at), timezone)}
          appointment={modal.mode === 'reschedule' ? modal.appointment : undefined}
          onClose={() => setModal(null)}
          onSaved={reload}
        />
      )}
    </div>
  )
}
