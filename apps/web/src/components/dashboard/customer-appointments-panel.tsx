'use client'

import { useState } from 'react'
import { CalendarPlus, MapPin } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { localDateString } from '@/lib/slot-engine'
import { AppointmentFormModal } from '@/components/dashboard/appointment-form-modal'
import type { AppointmentWithRelations } from '@/components/dashboard/calendar-view'
import { StatusPill, type BadgeVariant } from '@/components/ui/dashboard-ui'
import type {
  AppointmentStatus,
  Customer,
  Employee,
  SchedulingSettings,
  Service,
  WeeklySchedule,
} from '@/lib/types'

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

/** Fire-and-forget, mesma receita do calendário: a mutação já foi gravada, o aviso nunca vira erro pro usuário. */
function notifyAppointment(unitId: string, appointmentId: string, event: 'cancelled') {
  void fetch(`/api/units/${unitId}/appointments/${appointmentId}/notify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event }),
  }).catch(() => {})
}

/**
 * Agendamentos direto da ficha do cliente (modo gestão completa): agendar
 * serviço novo (único ou toda semana), remarcar, mudar valor/descrição e
 * cancelar — sem sair do cadastro. Reusa o mesmo modal e as mesmas regras
 * do calendário da unidade; o valor e a recorrência padrão vêm do
 * "Serviço contratado" do cliente (custom_fields).
 */
export function CustomerAppointmentsPanel({
  customer,
  unitId,
  orgId,
  timezone,
  businessHours,
  schedulingSettings,
  services,
  employees,
  initialAppointments,
}: {
  customer: Customer
  unitId: string
  orgId: string
  timezone: string
  businessHours: WeeklySchedule
  schedulingSettings: SchedulingSettings
  services: Service[]
  employees: Employee[]
  initialAppointments: AppointmentWithRelations[]
}) {
  const [appointments, setAppointments] = useState<AppointmentWithRelations[]>(initialAppointments)
  const [modal, setModal] = useState<{ mode: 'create' } | { mode: 'reschedule'; appointment: AppointmentWithRelations } | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [rowError, setRowError] = useState<string | null>(null)

  const canBook = services.length > 0 && employees.length > 0

  const cf = (customer.custom_fields ?? {}) as { service_value?: unknown; service_recurrence?: unknown }
  const defaultPrice = Number(cf.service_value) > 0 ? Number(cf.service_value) : null
  const defaultWeekly = cf.service_recurrence === 'weekly'

  async function reload() {
    const supabase = createClient()
    const { data } = await supabase
      .from('appointments')
      .select('*, customer:customers(id,name,phone), service:services(id,name), employee:employees(id,name)')
      .eq('customer_id', customer.id)
      .order('starts_at', { ascending: false })
      .limit(20)
    setAppointments((data ?? []) as unknown as AppointmentWithRelations[])
  }

  async function handleCancel(appointment: AppointmentWithRelations) {
    if (!window.confirm('Cancelar este agendamento?')) return
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

  function formatWhen(a: AppointmentWithRelations): string {
    const date = new Date(a.starts_at).toLocaleDateString('pt-BR', {
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
      timeZone: timezone,
    })
    const time = new Date(a.starts_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: timezone })
    return `${date} · ${time}`
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-black uppercase tracking-widest text-slate-500">Agendamentos</p>
        <button
          type="button"
          disabled={!canBook}
          onClick={() => setModal({ mode: 'create' })}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold text-white transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-40"
          style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)' }}
        >
          <CalendarPlus size={13} />
          Agendar serviço
        </button>
      </div>

      {!canBook && (
        <p className="text-xs text-amber-400">
          Configure serviços e profissionais na agenda da unidade antes de agendar.
        </p>
      )}
      {rowError && <p className="text-sm text-red-400">{rowError}</p>}

      {appointments.length === 0 ? (
        <p className="rounded-xl px-4 py-5 text-center text-sm text-slate-500" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
          Nenhum serviço agendado ainda pra este cliente.
        </p>
      ) : (
        <div className="flex flex-col rounded-xl" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
          {appointments.map((a) => {
            const isActive = a.status === 'scheduled' || a.status === 'confirmed'
            const price = Number((a.custom_fields as { price?: unknown } | null)?.price)
            return (
              <div
                key={a.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}
              >
                <div className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-white">{formatWhen(a)}</span>
                    <StatusPill variant={STATUS_VARIANT[a.status]}>{STATUS_LABEL[a.status]}</StatusPill>
                    {a.recurrence === 'weekly' && (
                      <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: 'rgba(129,140,248,0.15)', color: '#a5b4fc' }}>
                        Toda semana
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400">
                    {a.service?.name ?? 'Serviço'}
                    {a.employee?.name ? ` · ${a.employee.name}` : ''}
                    {Number.isFinite(price) && price > 0 ? ` · ${price.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : ''}
                  </p>
                  {a.address && (
                    <p className="flex items-center gap-1 text-xs text-slate-500">
                      <MapPin size={11} />
                      {a.address}
                    </p>
                  )}
                  {a.notes && <p className="text-xs text-slate-500">{a.notes}</p>}
                </div>

                {isActive && (
                  <div className="flex flex-wrap gap-3 text-xs font-semibold">
                    <button
                      type="button"
                      disabled={busyId === a.id}
                      className="text-cyan-400 hover:text-cyan-300 disabled:opacity-40"
                      onClick={() => setModal({ mode: 'reschedule', appointment: a })}
                    >
                      Remarcar / editar valor
                    </button>
                    <button
                      type="button"
                      disabled={busyId === a.id}
                      className="text-red-400 hover:text-red-300 disabled:opacity-40"
                      onClick={() => handleCancel(a)}
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

      {modal && (
        <AppointmentFormModal
          unitId={unitId}
          orgId={orgId}
          timezone={timezone}
          businessHours={businessHours}
          schedulingSettings={schedulingSettings}
          services={services}
          employees={employees}
          mode={modal.mode}
          initialDate={
            modal.mode === 'reschedule'
              ? localDateString(new Date(modal.appointment.starts_at), timezone)
              : localDateString(new Date(), timezone)
          }
          appointment={modal.mode === 'reschedule' ? modal.appointment : undefined}
          initialCustomer={{ id: customer.id, name: customer.name, phone: customer.phone, address: customer.address }}
          defaultPrice={defaultPrice}
          defaultWeekly={defaultWeekly}
          onClose={() => setModal(null)}
          onSaved={reload}
        />
      )}
    </div>
  )
}
