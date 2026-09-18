'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarPlus, ClipboardList, MapPin, Search, Trash2, Upload, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { localDateString, zonedTimeToUtc } from '@/lib/slot-engine'
import { addDays } from '@/lib/calendar-dates'
import { RECURRENCE_PILL_LABEL } from '@/lib/scheduling/recurrence'
import { AppointmentFormModal } from '@/components/dashboard/appointment-form-modal'
import { ServiceOrderAttachModal } from '@/components/dashboard/service-order-attach-modal'
import { BulkServiceOrderImportModal } from '@/components/dashboard/bulk-service-order-import-modal'
import { Badge, Card, Input, Select, StatusPill, type BadgeVariant } from '@/components/ui/dashboard-ui'
import { CLIENT_PORTAL_SOURCE } from '@/lib/portal-360/constants'
import { FACILIT_SYNC_SOURCE } from '@/lib/facilit-appointment'
import { effectiveDisplayStatus, type EffectiveDisplayStatus } from '@/lib/scheduling/appointment-display-status'
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
  | { mode: 'service-order'; appointment: AppointmentWithRelations }
  | { mode: 'bulk-import' }

const STATUS_VARIANT: Record<EffectiveDisplayStatus, BadgeVariant> = {
  scheduled: 'cyan',
  confirmed: 'blue',
  completed: 'green',
  cancelled: 'slate',
  no_show: 'red',
  quote: 'purple',
}

const STATUS_LABEL: Record<EffectiveDisplayStatus, string> = {
  scheduled: 'Agendado',
  confirmed: 'Confirmado',
  completed: 'Concluído',
  cancelled: 'Cancelado',
  no_show: 'Faltou',
  quote: 'Cotação',
}

const ACTIVE_STATUSES: AppointmentStatus[] = ['scheduled', 'confirmed']

const SERVICE_ORDER_STATUS_LABEL: Record<string, string> = {
  pending: 'Ordem pendente',
  completed: 'Ordem finalizada',
  quote: 'Ordem em cotação',
}

/**
 * Filtro por status + nº da ordem — pedido do Vinicius (2026-09-17):
 * "as ordens antigas não podem sumir da agenda", principalmente as em
 * cotação, que ficam de pé indefinidamente até serem aprovadas pelo
 * cliente (podem ser de semanas atrás). Sem isso, a única forma de
 * achar uma ordem antiga era navegar semana por semana no calendário —
 * e ordens de cotação muitas vezes nem têm uma data real associada
 * (starts_at é placeholder quando vieram do Portal 360).
 */
type ServiceOrderStatusFilter = 'all' | 'pending' | 'completed' | 'quote'

const STATUS_FILTER_OPTIONS: { value: ServiceOrderStatusFilter; label: string }[] = [
  { value: 'all', label: 'Todos os status' },
  { value: 'quote', label: 'Cotação' },
  { value: 'completed', label: 'Finalizado' },
  { value: 'pending', label: 'Pendente' },
]

const SERVICE_ORDER_STATUS_VARIANT: Record<string, BadgeVariant> = {
  pending: 'amber',
  completed: 'green',
  quote: 'purple',
}

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

/**
 * appointment sem employee_id ainda pendente de atribuição pelo admin:
 * ou veio do Portal 360 (migration 061 — starts_at é só placeholder,
 * nunca mostrar como horário real) ou do sync automático da Facil-IT
 * (migration 081 — aí starts_at já É a visita real informada pela
 * Facil-IT, pode mostrar normalmente).
 */
function isPendingAssignment(appointment: Pick<Appointment, 'employee_id' | 'source'>): boolean {
  return !appointment.employee_id && (appointment.source === CLIENT_PORTAL_SOURCE || appointment.source === FACILIT_SYNC_SOURCE)
}

function formatRequestedDate(dateStr: string | null): string {
  if (!dateStr) return '-'
  const [year, month, day] = dateStr.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' })
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
  const router = useRouter()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [rowError, setRowError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<ServiceOrderStatusFilter>('all')
  const [orderQuery, setOrderQuery] = useState('')
  const [searchResults, setSearchResults] = useState<AppointmentWithRelations[]>([])
  const [searching, setSearching] = useState(false)

  const canBook = !!orgId && services.length > 0 && employees.length > 0
  const isFiltering = statusFilter !== 'all' || orderQuery.trim() !== ''

  /**
   * Bug real (2026-09-17, achado do Vinicius): trocar de semana (link
   * "Semana anterior/Próxima semana", que só muda o `?start=` da URL)
   * buscava os agendamentos certos no servidor, mas o `useState`
   * abaixo só usa `initialAppointments` como valor INICIAL — numa
   * navegação client-side o componente não desmonta, então o estado
   * antigo ficava preso até um F5 de verdade remontar o componente do
   * zero. Sincroniza sempre que o servidor mandar um array novo (só
   * acontece de fato numa navegação real, nunca por causa de estado
   * puramente local como digitar no filtro ou abrir um modal).
   */
  useEffect(() => {
    setAppointments(initialAppointments)
  }, [initialAppointments])

  /** Busca por nº da ordem/status, SEM limite de data — ignora a semana visível de propósito, pra achar ordens antigas (ver comentário de STATUS_FILTER_OPTIONS acima). */
  async function runSearch(): Promise<AppointmentWithRelations[]> {
    const supabase = createClient()
    let query = supabase
      .from('appointments')
      .select('*, customer:customers(id,name,phone), service:services(id,name), employee:employees(id,name)')
      .eq('unit_id', unitId)
      .not('service_order_number', 'is', null)
      .order('starts_at', { ascending: false })
      .limit(100)
    if (statusFilter !== 'all') query = query.eq('service_order_status', statusFilter)
    const trimmedQuery = orderQuery.trim()
    if (trimmedQuery) query = query.ilike('service_order_number', `%${trimmedQuery}%`)
    const { data } = await query
    const fresh = (data ?? []) as unknown as AppointmentWithRelations[]
    setSearchResults(fresh)
    return fresh
  }

  async function reload() {
    if (isFiltering) return runSearch()
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
    const fresh = (data ?? []) as unknown as AppointmentWithRelations[]
    setAppointments(fresh)
    return fresh
  }

  // Debounce de 300ms pro campo de texto — evita 1 query por tecla digitada.
  useEffect(() => {
    if (!isFiltering) {
      setSearchResults([])
      return
    }
    setSearching(true)
    const timeout = setTimeout(() => {
      void runSearch().finally(() => setSearching(false))
    }, 300)
    return () => clearTimeout(timeout)
  }, [isFiltering, statusFilter, orderQuery])

  const displayedAppointments = isFiltering ? searchResults : appointments
  const displayedDates = isFiltering
    ? Array.from(new Set(displayedAppointments.map((a) => localDateString(new Date(a.starts_at), timezone)))).sort().reverse()
    : weekDates

  /**
   * Hard-delete de verdade: apaga o agendamento inteiro (não só limpa
   * os campos service_order_*, ver ServiceOrderAttachModal.handleDelete
   * pra isso) — pedido explícito do dono do produto pra "sumir com
   * tudo do sistema", principalmente pra agendamento+ordem cancelados.
   * RLS de appointments_write já é "for all" pra org_admin, cobre
   * DELETE sem migration nova.
   */
  async function handleDeleteAppointment(appointment: AppointmentWithRelations) {
    if (
      !window.confirm(
        `Excluir definitivamente o agendamento${appointment.customer?.name ? ` de ${appointment.customer.name}` : ''}? Isso apaga o agendamento e a ordem de serviço anexada (se houver) do sistema. Essa ação não pode ser desfeita.`
      )
    ) {
      return
    }
    setRowError(null)
    setBusyId(appointment.id)
    const supabase = createClient()
    const { error } = await supabase.from('appointments').delete().eq('id', appointment.id)
    setBusyId(null)
    if (error) {
      setRowError('Não foi possível excluir o agendamento.')
      return
    }
    await reload()
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
   * Concluir = o serviço aconteceu, e fechar isso sempre envolve decidir
   * quem atendeu de fato, quanto cobrar e quanto pagar — pedido do
   * Vinicius (2026-09-16): em vez de lançar tudo sozinho (sugestão
   * automática, sem revisão), "Concluir" leva pra Operação com o
   * formulário já preenchido (técnico, valores sugeridos, nº da ordem
   * na descrição) pra revisar/ajustar antes de confirmar — é lá que
   * status/service_records/recorrência de fato são gravados (ver
   * handleRecordSubmit em service-operations-panel.tsx).
   */
  function handleComplete(appointment: AppointmentWithRelations) {
    router.push(`/dashboard/units/${unitId}/operacao?completeAppointment=${appointment.id}`)
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

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
            <Input
              value={orderQuery}
              onChange={(e) => setOrderQuery(e.target.value)}
              placeholder="Buscar por nº da ordem"
              className="py-1.5 pl-8 text-xs"
              style={{ width: 200 }}
            />
          </div>
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as ServiceOrderStatusFilter)} className="py-1.5 text-xs" style={{ width: 160 }}>
            {STATUS_FILTER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
          {isFiltering && (
            <button
              type="button"
              onClick={() => {
                setOrderQuery('')
                setStatusFilter('all')
              }}
              className="flex items-center gap-1 text-xs font-semibold text-slate-400 hover:text-slate-200"
            >
              <X size={12} />
              Limpar filtro
            </button>
          )}
        </div>
        <button
          type="button"
          disabled={!canBook}
          onClick={() => setModal({ mode: 'bulk-import' })}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold text-indigo-300 transition-colors hover:text-indigo-200 disabled:opacity-40"
          style={{ background: 'rgba(129,140,248,0.08)', border: '1px solid rgba(129,140,248,0.25)' }}
        >
          <Upload size={13} />
          Anexar ordens do dia
        </button>
      </div>

      {isFiltering && (
        <p className="text-xs text-slate-500">
          {searching
            ? 'Buscando…'
            : `A busca ignora a semana selecionada — mostra qualquer ordem de qualquer data que combine (até 100 resultados).`}
        </p>
      )}

      {isFiltering && !searching && displayedAppointments.length === 0 && (
        <Card className="px-5 py-4 text-sm text-slate-500">Nenhuma ordem encontrada com esse filtro.</Card>
      )}

      {displayedDates.map((date) => {
        const dayAppointments = displayedAppointments
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
              {!isFiltering && (
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
              )}
            </div>

            {dayAppointments.length === 0 ? (
              <p className="px-5 py-4 text-sm text-slate-500">Nenhum agendamento.</p>
            ) : (
              <div className="flex flex-col">
                {dayAppointments.map((appointment) => {
                  const isActive = ACTIVE_STATUSES.includes(appointment.status)
                  const isPast = new Date(appointment.starts_at).getTime() < now
                  const pendingAssignment = isPendingAssignment(appointment)
                  return (
                    <div
                      key={appointment.id}
                      className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
                      style={{
                        borderBottom: '1px solid rgba(255,255,255,0.04)',
                        ...(pendingAssignment ? { background: 'rgba(245,158,11,0.05)' } : {}),
                      }}
                    >
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-2">
                          {pendingAssignment ? (
                            <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: 'rgba(245,158,11,0.15)', color: '#fbbf24' }}>
                              {appointment.source === FACILIT_SYNC_SOURCE
                                ? `Facil-IT · ${formatTimeRange(appointment.starts_at, appointment.ends_at, timezone)} · Sem técnico atribuído`
                                : `360 requested · ${formatRequestedDate(appointment.service_order_requested_date)} · No technician assigned yet`}
                            </span>
                          ) : (
                            <>
                              <span className="text-sm font-semibold text-white">
                                {formatTimeRange(appointment.starts_at, appointment.ends_at, timezone)}
                              </span>
                              <StatusPill variant={STATUS_VARIANT[effectiveDisplayStatus(appointment)]}>
                                {STATUS_LABEL[effectiveDisplayStatus(appointment)]}
                              </StatusPill>
                            </>
                          )}
                          {appointment.recurrence && (
                            <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: 'rgba(129,140,248,0.15)', color: '#a5b4fc' }}>
                              {RECURRENCE_PILL_LABEL[appointment.recurrence]}
                            </span>
                          )}
                          {appointment.service_order_number && (
                            <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: 'rgba(217,70,239,0.15)', color: '#f0abfc' }}>
                              Nº {appointment.service_order_number}
                              {appointment.service_order_location_name ? ` · ${appointment.service_order_location_name}` : ''}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-400">
                          {appointment.customer?.name ?? 'Cliente removido'}
                          {appointment.service?.name ? ` · ${appointment.service.name}` : ''}
                          {appointment.employee?.name ? ` · ${appointment.employee.name}` : ''}
                        </p>
                        {appointment.address && (
                          <a
                            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(appointment.address)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 text-xs text-slate-500 hover:text-cyan-400 hover:underline"
                            title="Abrir no Google Maps"
                          >
                            <MapPin size={11} />
                            {appointment.address}
                          </a>
                        )}
                      </div>

                      {isActive && (
                        <div className="flex flex-wrap gap-3 text-xs font-semibold">
                          {!pendingAssignment && isToday &&
                            (appointment.on_my_way_sent_at ? (
                              <span className="text-emerald-400">Mensagem "a caminho" enviada ✓</span>
                            ) : (
                              <button
                                type="button"
                                disabled={busyId === appointment.id}
                                className="text-emerald-400 hover:text-emerald-300 disabled:opacity-40"
                                onClick={() => handleOnMyWay(appointment)}
                                title="Envia uma mensagem avisando o cliente — não é rastreamento por GPS, é um disparo manual único."
                              >
                                Avisar cliente que estou a caminho
                              </button>
                            ))}
                          <button
                            type="button"
                            disabled={busyId === appointment.id}
                            className="text-cyan-400 hover:text-cyan-300 disabled:opacity-40"
                            onClick={() => setModal({ mode: 'reschedule', appointment })}
                          >
                            {pendingAssignment ? 'Atribuir profissional e horário' : 'Reagendar'}
                          </button>
                          {!pendingAssignment && isPast && (
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

                      <button
                        type="button"
                        disabled={busyId === appointment.id}
                        onClick={() => handleDeleteAppointment(appointment)}
                        title="Exclui o agendamento e a ordem de serviço anexada por completo, sem deixar rastro no sistema."
                        className={
                          appointment.status === 'cancelled'
                            ? 'flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-bold text-red-300 transition-colors hover:text-red-200 disabled:opacity-40'
                            : 'flex items-center gap-1.5 text-xs font-semibold text-slate-500 transition-colors hover:text-red-400 disabled:opacity-40'
                        }
                        style={appointment.status === 'cancelled' ? { background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)' } : undefined}
                      >
                        <Trash2 size={12} />
                        Excluir agendamento
                      </button>

                      {(appointment.employee_id || appointment.service_order_file_url) && (
                        <div className="flex items-center gap-2">
                          {appointment.service_order_file_url && (
                            <Badge variant={SERVICE_ORDER_STATUS_VARIANT[appointment.service_order_status] ?? 'slate'}>
                              {SERVICE_ORDER_STATUS_LABEL[appointment.service_order_status] ?? appointment.service_order_status}
                            </Badge>
                          )}
                          <button
                            type="button"
                            className="flex items-center gap-1.5 text-xs font-semibold text-indigo-400 hover:text-indigo-300"
                            onClick={() => setModal({ mode: 'service-order', appointment })}
                          >
                            <ClipboardList size={12} />
                            {appointment.service_order_file_url ? 'Editar ordem de serviço' : 'Anexar ordem de serviço'}
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

      {modal && (modal.mode === 'create' || modal.mode === 'reschedule') && (
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
          onSaved={async () => {
            await reload()
          }}
        />
      )}

      {modal && modal.mode === 'service-order' && (
        <ServiceOrderAttachModal
          unitId={unitId}
          appointment={modal.appointment}
          onClose={() => setModal(null)}
          onSaved={async () => {
            await reload()
          }}
        />
      )}

      {modal && modal.mode === 'bulk-import' && orgId && (
        <BulkServiceOrderImportModal
          unitId={unitId}
          orgId={orgId}
          timezone={timezone}
          services={services}
          employees={employees}
          initialDate={todayLocal}
          onClose={() => setModal(null)}
          onSaved={async () => {
            await reload()
          }}
        />
      )}
    </div>
  )
}
