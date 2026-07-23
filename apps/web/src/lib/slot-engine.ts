// ============================================================
// Agenda Inteligente — motor de cálculo de horários livres
// (Fase 2, sub-etapa 3/7)
//
// Função pura: quem chama busca unit/service/employee/appointments
// no banco e passa como argumento. Nenhum I/O aqui.
// ============================================================

import type {
  Appointment,
  AppointmentStatus,
  SchedulingSettings,
  Service,
  TimeInterval,
  Weekday,
  WeeklySchedule,
} from '@/lib/types'

const WEEKDAYS_BY_UTC_DAY: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

/** Status que não ocupam a agenda (não bloqueiam slots nem contam pra capacidade). */
const INACTIVE_STATUSES: AppointmentStatus[] = ['cancelled', 'no_show']

export type SlotEngineAppointment = Pick<Appointment, 'starts_at' | 'ends_at' | 'status'>

export type AvailableSlot = { starts_at: string; ends_at: string }

export type SlotEngineInput = {
  /** Data-calendário local (fuso da unidade), formato 'YYYY-MM-DD'. */
  date: string
  /** Fuso IANA da unidade (unit.timezone). */
  timezone: string
  businessHours: WeeklySchedule
  schedulingSettings: SchedulingSettings
  service: Pick<Service, 'duration_minutes' | 'buffer_minutes' | 'capacity_per_slot'>
  /**
   * Grade do funcionário (employee.availability). Omitido ou jsonb vazio
   * ({}) = funcionário segue integralmente o horário da unidade. Quando
   * preenchida, vale a interseção com business_hours (dia ausente na
   * grade do funcionário = indisponível naquele dia, sem herdar a unidade).
   */
  employeeAvailability?: WeeklySchedule
  /** Agendamentos já existentes que podem colidir (já filtrados pelo chamador por unidade/funcionário/recurso relevante). */
  existingAppointments: SlotEngineAppointment[]
  /** Instante de referência para "agora". Default: new Date(). Injetável para testes. */
  now?: Date
}

function isNonEmptySchedule(schedule: WeeklySchedule | undefined): schedule is WeeklySchedule {
  return !!schedule && Object.keys(schedule).length > 0
}

function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number) as [number, number]
  return hours * 60 + minutes
}

function minutesToTime(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

/** Interseção de duas listas de janelas do mesmo dia. Sem overlap = dia sem slots. */
function intersectIntervals(a: TimeInterval[], b: TimeInterval[]): TimeInterval[] {
  const result: TimeInterval[] = []
  for (const windowA of a) {
    for (const windowB of b) {
      const start = Math.max(timeToMinutes(windowA.start), timeToMinutes(windowB.start))
      const end = Math.min(timeToMinutes(windowA.end), timeToMinutes(windowB.end))
      if (end > start) result.push({ start: minutesToTime(start), end: minutesToTime(end) })
    }
  }
  return result
}

export function weekdayOfDateString(dateStr: string): Weekday {
  const [year, month, day] = dateStr.split('-').map(Number) as [number, number, number]
  const utcDate = new Date(Date.UTC(year, month - 1, day))
  return WEEKDAYS_BY_UTC_DAY[utcDate.getUTCDay()]!
}

function getZonedParts(date: Date, timeZone: string) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const map: Record<string, string> = {}
  for (const part of dtf.formatToParts(date)) {
    if (part.type !== 'literal') map[part.type] = part.value
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  }
}

function getTimeZoneOffsetMinutes(timeZone: string, instant: Date): number {
  const p = getZonedParts(instant, timeZone)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return (asUtc - instant.getTime()) / 60000
}

/**
 * Converte uma data+hora local (no fuso `timeZone`) para o instante UTC
 * correspondente. Resolve a virada de DST com uma segunda iteração
 * (recalcula o offset no instante candidato e corrige se ele mudou).
 */
export function zonedTimeToUtc(dateStr: string, timeStr: string, timeZone: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number) as [number, number, number]
  const [hours, minutes] = timeStr.split(':').map(Number) as [number, number]
  const naiveUtc = new Date(Date.UTC(year, month - 1, day, hours, minutes, 0))
  const offset1 = getTimeZoneOffsetMinutes(timeZone, naiveUtc)
  const candidate = new Date(naiveUtc.getTime() - offset1 * 60000)
  const offset2 = getTimeZoneOffsetMinutes(timeZone, candidate)
  if (offset2 !== offset1) {
    return new Date(naiveUtc.getTime() - offset2 * 60000)
  }
  return candidate
}

/** Data-calendário ('YYYY-MM-DD') de um instante, observada no fuso `timeZone`. */
export function localDateString(instant: Date, timeZone: string): string {
  const p = getZonedParts(instant, timeZone)
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

function diffInCalendarDays(dateStr: string, baseDateStr: string): number {
  const [y1, m1, d1] = dateStr.split('-').map(Number) as [number, number, number]
  const [y2, m2, d2] = baseDateStr.split('-').map(Number) as [number, number, number]
  const a = Date.UTC(y1, m1 - 1, d1)
  const b = Date.UTC(y2, m2 - 1, d2)
  return Math.round((a - b) / 86_400_000)
}

/**
 * Um candidato de slot fica indisponível se:
 * - já existe agendamento ativo com o mesmo starts_at e a capacidade do
 *   serviço nesse horário exato já está esgotada; ou
 * - colide (respeitando o buffer do serviço, aplicado simetricamente dos
 *   dois lados por não sabermos o buffer do serviço já agendado) com um
 *   agendamento ativo que começa em outro horário.
 */
function isSlotFree(
  slotStart: Date,
  slotEnd: Date,
  service: Pick<Service, 'buffer_minutes' | 'capacity_per_slot'>,
  activeAppointments: SlotEngineAppointment[]
): boolean {
  const bufferMs = service.buffer_minutes * 60_000
  const slotStartMs = slotStart.getTime()
  const slotEndMs = slotEnd.getTime()
  let sameStartCount = 0

  for (const appt of activeAppointments) {
    const apptStartMs = new Date(appt.starts_at).getTime()
    const apptEndMs = new Date(appt.ends_at).getTime()

    if (apptStartMs === slotStartMs) {
      sameStartCount += 1
      continue
    }

    const overlaps = slotStartMs < apptEndMs + bufferMs && apptStartMs < slotEndMs + bufferMs
    if (overlaps) return false
  }

  return sameStartCount < service.capacity_per_slot
}

/** Calcula os slots livres de um único dia local. */
export function getAvailableSlots(input: SlotEngineInput): AvailableSlot[] {
  const now = input.now ?? new Date()
  const settings = input.schedulingSettings
  const weekday = weekdayOfDateString(input.date)

  const todayLocal = localDateString(now, input.timezone)
  const daysAhead = diffInCalendarDays(input.date, todayLocal)
  if (daysAhead < 0 || daysAhead > settings.max_advance_days) return []

  const businessWindows = input.businessHours[weekday] ?? []
  if (businessWindows.length === 0) return []

  const employeeWindows = isNonEmptySchedule(input.employeeAvailability)
    ? input.employeeAvailability[weekday] ?? []
    : businessWindows

  const effectiveWindows = intersectIntervals(businessWindows, employeeWindows)
  if (effectiveWindows.length === 0) return []

  const activeAppointments = input.existingAppointments.filter(
    (appt) => !INACTIVE_STATUSES.includes(appt.status)
  )

  const minStartMs = now.getTime() + settings.min_notice_minutes * 60_000
  const slots: AvailableSlot[] = []

  for (const window of effectiveWindows) {
    const windowStartMin = timeToMinutes(window.start)
    const windowEndMin = timeToMinutes(window.end)

    for (
      let slotStartMin = windowStartMin;
      slotStartMin + input.service.duration_minutes <= windowEndMin;
      slotStartMin += settings.slot_interval_minutes
    ) {
      const slotStartUtc = zonedTimeToUtc(input.date, minutesToTime(slotStartMin), input.timezone)
      if (slotStartUtc.getTime() < minStartMs) continue

      const slotEndUtc = new Date(
        slotStartUtc.getTime() + input.service.duration_minutes * 60_000
      )

      if (!isSlotFree(slotStartUtc, slotEndUtc, input.service, activeAppointments)) continue

      slots.push({ starts_at: slotStartUtc.toISOString(), ends_at: slotEndUtc.toISOString() })
    }
  }

  return slots
}

export type SlotEngineRangeInput = Omit<SlotEngineInput, 'date'> & {
  /** Data inicial do intervalo, 'YYYY-MM-DD' local. */
  startDate: string
  /** Data final do intervalo (inclusiva), 'YYYY-MM-DD' local. */
  endDate: string
}

/** Calcula os slots livres de cada dia num intervalo, dia a dia. */
export function getAvailableSlotsForRange(
  input: SlotEngineRangeInput
): Record<string, AvailableSlot[]> {
  const { startDate, endDate, ...rest } = input
  const totalDays = diffInCalendarDays(endDate, startDate)
  const result: Record<string, AvailableSlot[]> = {}

  for (let offset = 0; offset <= totalDays; offset += 1) {
    const [year, month, day] = startDate.split('-').map(Number) as [number, number, number]
    const cursor = new Date(Date.UTC(year, month - 1, day + offset))
    const dateStr = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}-${String(cursor.getUTCDate()).padStart(2, '0')}`
    result[dateStr] = getAvailableSlots({ ...rest, date: dateStr })
  }

  return result
}
