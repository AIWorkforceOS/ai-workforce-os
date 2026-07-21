'use client'

import { useState } from 'react'
import { CalendarPlus } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { localDateString, zonedTimeToUtc } from '@/lib/slot-engine'
import { addDays } from '@/lib/calendar-dates'
import { AppointmentFormModal } from '@/components/dashboard/appointment-form-modal'
import { Card, StatusPill, type BadgeVariant } from '@/components/ui/dashboard-ui'
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
    setRowError(null)
    setBusyId(appointment.id)
    const supabase = createClient()
    const { error } = await supabase
      .from('appointments')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('id', appointment.id)
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
                        </div>
                        <p className="text-xs text-slate-400">
                          {appointment.customer?.name ?? 'Cliente removido'}
                          {appointment.service?.name ? ` · ${appointment.service.name}` : ''}
                          {appointment.employee?.name ? ` · ${appointment.employee.name}` : ''}
                        </p>
                      </div>

                      {isActive && (
                        <div className="flex gap-3 text-xs font-semibold">
                          <button
                            type="button"
                            disabled={busyId === appointment.id}
                            className="text-cyan-400 hover:text-cyan-300 disabled:opacity-40"
                            onClick={() => setModal({ mode: 'reschedule', appointment })}
                          >
                            Reagendar
                          </button>
                          {isPast && (
                            <button
                              type="button"
                              disabled={busyId === appointment.id}
                              className="text-amber-400 hover:text-amber-300 disabled:opacity-40"
                              onClick={() => handleNoShow(appointment)}
                            >
                              Marcar falta
                            </button>
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
