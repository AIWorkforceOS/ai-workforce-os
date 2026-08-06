'use client'

import { useMemo, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, List, MapPin } from 'lucide-react'
import { Badge, EmptyState, type BadgeVariant } from '@/components/ui/dashboard-ui'
import { currentMonthInTimezone, monthLabel, shiftMonth } from '@/lib/service-operations-month'
import type { PortalAppointment } from '@/lib/portal-funcionario/data'

// Agenda do Portal do Funcionário: agendamento clicável (abre o
// detalhe com a descrição/observações completas, hoje só visível como
// nome do serviço) + visão de calendário mensal navegável, alternável
// com a lista — pedido direto do dono do produto. Client component
// porque as duas interações (expandir detalhe, navegar mês no
// calendário) não precisam de ida ao servidor: já temos todos os
// agendamentos do funcionário (desde PORTAL_DATA_SINCE) em memória.

const STATUS_LABEL: Record<string, string> = {
  scheduled: 'Agendado',
  confirmed: 'Confirmado',
  completed: 'Concluído',
  cancelled: 'Cancelado',
  no_show: 'Faltou',
}

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  scheduled: 'blue',
  confirmed: 'cyan',
  completed: 'green',
  cancelled: 'slate',
  no_show: 'red',
}

function dayKeyInTimezone(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date(iso))
}

function formatDateTime(iso: string, locale: string): string {
  return new Date(iso).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' })
}

function formatTimeRange(startsAt: string, endsAt: string, locale: string): string {
  const start = new Date(startsAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  const end = new Date(endsAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  return `${start} – ${end}`
}

function AppointmentRow({
  appt,
  locale,
  expanded,
  onToggle,
}: {
  appt: PortalAppointment
  locale: string
  expanded: boolean
  onToggle: () => void
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full flex-col gap-1 px-5 py-4 text-left transition-colors hover:bg-white/[0.03] sm:flex-row sm:items-center sm:justify-between"
        aria-expanded={expanded}
      >
        <div>
          <p className="text-sm font-semibold text-white">
            {appt.customers?.name ?? 'Cliente'} {appt.services?.name ? `· ${appt.services.name}` : ''}
          </p>
          <p className="mt-0.5 text-[12px] text-slate-400">{formatDateTime(appt.starts_at, locale)}</p>
          {appt.address && <p className="text-[11px] text-slate-500">{appt.address}</p>}
        </div>
        <Badge variant={STATUS_VARIANT[appt.status] ?? 'slate'}>{STATUS_LABEL[appt.status] ?? appt.status}</Badge>
      </button>
      {expanded && (
        <div
          className="mx-5 mb-4 flex flex-col gap-2 rounded-xl px-4 py-3 text-[13px]"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold text-white">{appt.services?.name ?? 'Serviço'}</span>
            <span className="text-slate-400">{formatTimeRange(appt.starts_at, appt.ends_at, locale)}</span>
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Descrição do serviço</p>
            <p className="mt-0.5 text-slate-300">{appt.notes || 'Sem observações registradas para este agendamento.'}</p>
          </div>
          {appt.address && (
            <div className="flex items-center gap-1.5 text-slate-400">
              <MapPin size={12} />
              <span>{appt.address}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function AppointmentList({
  appointments,
  locale,
  expandedId,
  onToggle,
}: {
  appointments: PortalAppointment[]
  locale: string
  expandedId: string | null
  onToggle: (id: string) => void
}) {
  if (appointments.length === 0) {
    return (
      <EmptyState
        icon={<CalendarDays size={22} className="text-white" />}
        title="Nenhum agendamento ainda"
        subtitle="Quando a unidade agendar um trabalho no seu nome, ele aparece aqui."
      />
    )
  }
  return (
    <div className="flex flex-col divide-y" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
      {appointments.map((appt) => (
        <AppointmentRow
          key={appt.id}
          appt={appt}
          locale={locale}
          expanded={expandedId === appt.id}
          onToggle={() => onToggle(appt.id)}
        />
      ))}
    </div>
  )
}

const WEEKDAY_LABELS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']

export function AgendaSection({
  appointments,
  timezone,
  locale,
}: {
  appointments: PortalAppointment[]
  timezone: string
  locale: string
}) {
  const [viewMode, setViewMode] = useState<'lista' | 'calendario'>('lista')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [calendarMonth, setCalendarMonth] = useState(() => currentMonthInTimezone(timezone))
  const [selectedDay, setSelectedDay] = useState<string | null>(null)

  const appointmentsByDay = useMemo(() => {
    const map = new Map<string, PortalAppointment[]>()
    for (const appt of appointments) {
      const key = dayKeyInTimezone(appt.starts_at, timezone)
      const list = map.get(key) ?? []
      list.push(appt)
      map.set(key, list)
    }
    return map
  }, [appointments, timezone])

  const todayKey = useMemo(() => currentMonthInTimezone(timezone) === calendarMonth ? new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date()) : null, [timezone, calendarMonth])

  const toggleExpanded = (id: string) => setExpandedId((current) => (current === id ? null : id))

  const calendarGrid = useMemo(() => {
    const [year = 0, mon = 1] = calendarMonth.split('-').map(Number)
    const daysInMonth = new Date(year, mon, 0).getDate()
    const firstWeekday = new Date(year, mon - 1, 1).getDay()
    const cells: { date: string | null; day: number | null }[] = []
    for (let i = 0; i < firstWeekday; i++) cells.push({ date: null, day: null })
    for (let day = 1; day <= daysInMonth; day++) {
      cells.push({ date: `${calendarMonth}-${String(day).padStart(2, '0')}`, day })
    }
    while (cells.length % 7 !== 0) cells.push({ date: null, day: null })
    return cells
  }, [calendarMonth])

  const selectedDayAppointments = selectedDay ? (appointmentsByDay.get(selectedDay) ?? []) : []

  return (
    <div>
      <div className="flex items-center justify-between gap-3 p-5">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.15em] text-cyan-300">agenda</p>
          <h2 className="mt-1 text-base font-bold text-white">Seus agendamentos</h2>
        </div>
        <div
          className="flex items-center gap-0.5 rounded-xl p-0.5"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
        >
          <button
            type="button"
            onClick={() => setViewMode('lista')}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-all"
            style={
              viewMode === 'lista'
                ? { background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)', color: '#fff' }
                : { color: '#94a3b8' }
            }
          >
            <List size={13} />
            Lista
          </button>
          <button
            type="button"
            onClick={() => setViewMode('calendario')}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-all"
            style={
              viewMode === 'calendario'
                ? { background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)', color: '#fff' }
                : { color: '#94a3b8' }
            }
          >
            <CalendarDays size={13} />
            Calendário
          </button>
        </div>
      </div>

      {viewMode === 'lista' && (
        <AppointmentList appointments={appointments} locale={locale} expandedId={expandedId} onToggle={toggleExpanded} />
      )}

      {viewMode === 'calendario' && (
        <div className="px-5 pb-5">
          <div className="flex items-center justify-between gap-2 pb-3">
            <button
              type="button"
              onClick={() => {
                setCalendarMonth((m) => shiftMonth(m, -1))
                setSelectedDay(null)
              }}
              aria-label="Mês anterior"
              className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-300 transition-all hover:bg-white/5"
              style={{ border: '1px solid rgba(255,255,255,0.08)' }}
            >
              <ChevronLeft size={14} />
            </button>
            <p className="text-sm font-bold capitalize text-white">{monthLabel(calendarMonth, locale)}</p>
            <button
              type="button"
              onClick={() => {
                setCalendarMonth((m) => shiftMonth(m, 1))
                setSelectedDay(null)
              }}
              aria-label="Próximo mês"
              className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-300 transition-all hover:bg-white/5"
              style={{ border: '1px solid rgba(255,255,255,0.08)' }}
            >
              <ChevronRight size={14} />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center">
            {WEEKDAY_LABELS.map((label, i) => (
              <div key={i} className="py-1 text-[10px] font-bold uppercase text-slate-500">
                {label}
              </div>
            ))}
            {calendarGrid.map((cell, i) => {
              if (!cell.date) return <div key={i} />
              const dayAppointments = appointmentsByDay.get(cell.date) ?? []
              const hasAppointments = dayAppointments.length > 0
              const isToday = cell.date === todayKey
              const isSelected = cell.date === selectedDay
              return (
                <button
                  key={i}
                  type="button"
                  disabled={!hasAppointments}
                  onClick={() => setSelectedDay((d) => (d === cell.date ? null : cell.date))}
                  className="flex aspect-square flex-col items-center justify-center gap-0.5 rounded-lg text-xs transition-all disabled:cursor-default"
                  style={{
                    background: isSelected
                      ? 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)'
                      : hasAppointments
                        ? 'rgba(6,182,212,0.1)'
                        : 'transparent',
                    color: isSelected ? '#fff' : hasAppointments ? '#e2e8f0' : '#64748b',
                    border: isToday ? '1px solid rgba(6,182,212,0.6)' : '1px solid transparent',
                    fontWeight: hasAppointments ? 700 : 400,
                  }}
                >
                  <span>{cell.day}</span>
                  {hasAppointments && (
                    <span
                      className="h-1 w-1 rounded-full"
                      style={{ background: isSelected ? '#fff' : '#06b6d4' }}
                    />
                  )}
                </button>
              )
            })}
          </div>

          <div className="mt-4">
            {selectedDay ? (
              <div className="rounded-2xl" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
                <AppointmentList
                  appointments={selectedDayAppointments}
                  locale={locale}
                  expandedId={expandedId}
                  onToggle={toggleExpanded}
                />
              </div>
            ) : (
              <p className="px-1 text-[12px] text-slate-500">Toque em um dia com agendamento para ver os detalhes.</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
