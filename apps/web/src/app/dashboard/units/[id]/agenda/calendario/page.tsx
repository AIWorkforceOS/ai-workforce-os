import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeft, ChevronRight, Clock, Settings } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { CalendarView, type AppointmentWithRelations } from '@/components/dashboard/calendar-view'
import { Card, PageHeader } from '@/components/ui/dashboard-ui'
import { getBusinessHours, getSchedulingSettings } from '@/lib/scheduling'
import { localDateString, zonedTimeToUtc } from '@/lib/slot-engine'
import { addDays } from '@/lib/calendar-dates'
import type { Employee, Service, Unit } from '@/lib/types'

const DAYS_IN_WEEK = 7
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Formata 'YYYY-MM-DD' como 'dd/mm', sem depender do fuso local do processo. */
function formatShortDate(dateStr: string): string {
  const [, month, day] = dateStr.split('-')
  return `${day}/${month}`
}

export default async function UnitCalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ start?: string }>
}) {
  const { id } = await params
  const { start } = await searchParams
  const supabase = await createClient()

  const { data: unit } = await supabase.from('units').select('*').eq('id', id).single()
  if (!unit) notFound()
  const unitRow = unit as Unit

  const todayLocal = localDateString(new Date(), unitRow.timezone)
  const weekStart = start && DATE_RE.test(start) ? start : todayLocal
  const weekDates = Array.from({ length: DAYS_IN_WEEK }, (_, i) => addDays(weekStart, i))
  const weekEnd = weekDates[weekDates.length - 1]!

  const rangeStartUtc = zonedTimeToUtc(weekStart, '00:00', unitRow.timezone).toISOString()
  const rangeEndUtc = zonedTimeToUtc(addDays(weekEnd, 1), '00:00', unitRow.timezone).toISOString()

  const [{ data: services }, { data: employees }, { data: appointments }] = await Promise.all([
    supabase.from('services').select('*').eq('unit_id', id).eq('is_active', true).order('name'),
    supabase
      .from('employees')
      .select('*')
      .eq('unit_id', id)
      .eq('is_active', true)
      .eq('is_schedulable', true)
      .order('name'),
    supabase
      .from('appointments')
      .select('*, customer:customers(id,name,phone), service:services(id,name), employee:employees(id,name)')
      .eq('unit_id', id)
      .gte('starts_at', rangeStartUtc)
      .lt('starts_at', rangeEndUtc)
      .order('starts_at'),
  ])

  const servicesRows = (services ?? []) as Service[]
  const employeesRows = (employees ?? []) as Employee[]
  const appointmentsRows = (appointments ?? []) as unknown as AppointmentWithRelations[]

  const weekRangeLabel = `${formatShortDate(weekStart)} – ${formatShortDate(weekEnd)}`

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="agenda inteligente"
        title={`Calendário — ${unitRow.name}`}
        subtitle="Agendar, reagendar, cancelar ou marcar falta em atendimentos."
        action={
          <div className="flex items-center gap-2">
            <Link
              href={`/dashboard/units/${id}/agenda/waitlist`}
              className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold text-slate-300 transition-all hover:bg-white/5"
              style={{ border: '1px solid rgba(255,255,255,0.08)' }}
            >
              <Clock size={13} />
              Lista de espera
            </Link>
            <Link
              href={`/dashboard/units/${id}/agenda`}
              className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold text-slate-300 transition-all hover:bg-white/5"
              style={{ border: '1px solid rgba(255,255,255,0.08)' }}
            >
              <Settings size={13} />
              Configurar agenda
            </Link>
          </div>
        }
      />

      <Card className="flex items-center justify-between px-4 py-3">
        <Link
          href={`/dashboard/units/${id}/agenda/calendario?start=${addDays(weekStart, -DAYS_IN_WEEK)}`}
          className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold text-slate-300 transition-colors hover:bg-white/5"
        >
          <ChevronLeft size={14} />
          Semana anterior
        </Link>
        <span className="text-sm font-semibold text-white">{weekRangeLabel}</span>
        <Link
          href={`/dashboard/units/${id}/agenda/calendario?start=${addDays(weekStart, DAYS_IN_WEEK)}`}
          className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold text-slate-300 transition-colors hover:bg-white/5"
        >
          Próxima semana
          <ChevronRight size={14} />
        </Link>
      </Card>

      {(servicesRows.length === 0 || employeesRows.length === 0) && (
        <Card className="px-6 py-4 text-sm text-amber-400">
          {servicesRows.length === 0 && employeesRows.length === 0
            ? 'Nenhum serviço ativo e nenhum profissional habilitado para agenda ainda — '
            : servicesRows.length === 0
              ? 'Nenhum serviço ativo cadastrado ainda — '
              : 'Nenhum profissional habilitado para agenda ainda — '}
          <Link href={`/dashboard/units/${id}/agenda`} className="font-bold underline">
            configure na tela de agenda
          </Link>{' '}
          antes de criar novos agendamentos.
        </Card>
      )}

      <CalendarView
        unitId={id}
        orgId={unitRow.org_id}
        timezone={unitRow.timezone}
        businessHours={getBusinessHours(unitRow)}
        schedulingSettings={getSchedulingSettings(unitRow)}
        services={servicesRows}
        employees={employeesRows}
        weekDates={weekDates}
        todayLocal={todayLocal}
        initialAppointments={appointmentsRows}
      />
    </div>
  )
}
