import { localDateString, weekdayOfDateString, zonedTimeToUtc } from '@/lib/slot-engine'
import { addDays } from '@/lib/calendar-dates'
import type { Weekday } from '@/lib/types'

/**
 * Motor de recorrência (migration 032, ampliado na migration 035) —
 * decisão de escopo: NÃO é RRULE de calendário. As ocorrências são
 * linhas reais em `appointments`, todas com o mesmo `recurrence` e o
 * mesmo `recurrence_group_id`:
 *   - na criação da série geramos um horizonte de ocorrências de uma vez;
 *   - a cada ocorrência CONCLUÍDA no calendário, penduramos +1 no fim da
 *     série (ver calendar-view.handleComplete) — assim uma série em uso
 *     nunca "acaba", sem precisar de cron novo.
 *
 * O horário é preservado no fuso da unidade (10:00 continua 10:00 mesmo
 * cruzando virada de horário de verão), por isso a conta é feita em
 * data/hora local (zonedTimeToUtc), nunca somando dias/semanas no
 * instante UTC.
 */
export const RECURRENCE_WEEKS_AHEAD = 12
const BIWEEKLY_OCCURRENCES_AHEAD = 6 // ~12 semanas
const MONTHLY_OCCURRENCES_AHEAD = 3 // ~3 meses

export type RecurrenceType = 'weekly' | 'biweekly' | 'monthly' | 'custom'

/** Rótulo curto pro selo "recorrente" na UI (calendário, ficha do cliente). */
export const RECURRENCE_PILL_LABEL: Record<RecurrenceType, string> = {
  weekly: 'Toda semana',
  biweekly: 'A cada 15 dias',
  monthly: 'Todo mês',
  custom: 'Personalizado',
}

export const WEEKDAY_ORDER: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

export type Occurrence = { starts_at: string; ends_at: string }

/** Hora local 'HH:MM' de um instante, observada no fuso `timeZone`. */
function localTimeString(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant)
  const hour = parts.find((p) => p.type === 'hour')?.value ?? '00'
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '00'
  return `${hour}:${minute}`
}

/** Soma `months` meses à data local, preservando hora — dia clampado ao último dia do mês de destino (ex.: 31/jan + 1 mês = 28 ou 29/fev). */
function addMonthsLocalDate(dateStr: string, months: number): string {
  const [year, month, day] = dateStr.split('-').map(Number) as [number, number, number]
  const totalMonthIndex = (year * 12 + (month - 1)) + months
  const targetYear = Math.floor(totalMonthIndex / 12)
  const targetMonth0 = ((totalMonthIndex % 12) + 12) % 12
  const daysInTargetMonth = new Date(Date.UTC(targetYear, targetMonth0 + 1, 0)).getUTCDate()
  const clampedDay = Math.min(day, daysInTargetMonth)
  return `${targetYear}-${String(targetMonth0 + 1).padStart(2, '0')}-${String(clampedDay).padStart(2, '0')}`
}

/** Ocorrência `weeksAhead` semanas depois, mesmo horário local e mesma duração. */
export function shiftOccurrenceByWeeks(
  base: Occurrence,
  weeksAhead: number,
  timezone: string,
): Occurrence {
  return shiftOccurrenceByDays(base, weeksAhead * 7, timezone)
}

/** Ocorrência `daysAhead` dias depois, mesmo horário local e mesma duração. */
function shiftOccurrenceByDays(base: Occurrence, daysAhead: number, timezone: string): Occurrence {
  const startInstant = new Date(base.starts_at)
  const durationMs = new Date(base.ends_at).getTime() - startInstant.getTime()
  const localDate = localDateString(startInstant, timezone)
  const localTime = localTimeString(startInstant, timezone)
  const starts = zonedTimeToUtc(addDays(localDate, daysAhead), localTime, timezone)
  return {
    starts_at: starts.toISOString(),
    ends_at: new Date(starts.getTime() + durationMs).toISOString(),
  }
}

/** Ocorrência `monthsAhead` meses depois, mesmo dia-do-mês (clampado), horário local e duração. */
export function shiftOccurrenceByMonths(base: Occurrence, monthsAhead: number, timezone: string): Occurrence {
  const startInstant = new Date(base.starts_at)
  const durationMs = new Date(base.ends_at).getTime() - startInstant.getTime()
  const localDate = localDateString(startInstant, timezone)
  const localTime = localTimeString(startInstant, timezone)
  const targetDate = addMonthsLocalDate(localDate, monthsAhead)
  const starts = zonedTimeToUtc(targetDate, localTime, timezone)
  return {
    starts_at: starts.toISOString(),
    ends_at: new Date(starts.getTime() + durationMs).toISOString(),
  }
}

/**
 * Gera a série semanal a partir da primeira ocorrência (inclusa como
 * semana 0). `weeks` = total de ocorrências retornadas.
 */
export function buildWeeklyOccurrences(
  first: Occurrence,
  timezone: string,
  weeks: number = RECURRENCE_WEEKS_AHEAD,
): Occurrence[] {
  const result: Occurrence[] = []
  for (let week = 0; week < weeks; week += 1) {
    result.push(week === 0 ? { ...first } : shiftOccurrenceByWeeks(first, week, timezone))
  }
  return result
}

/** Série quinzenal: mesma ideia da semanal, mas pulando 2 semanas por ocorrência. */
export function buildBiweeklyOccurrences(
  first: Occurrence,
  timezone: string,
  count: number = BIWEEKLY_OCCURRENCES_AHEAD,
): Occurrence[] {
  const result: Occurrence[] = []
  for (let i = 0; i < count; i += 1) {
    result.push(i === 0 ? { ...first } : shiftOccurrenceByWeeks(first, i * 2, timezone))
  }
  return result
}

/** Série mensal: mesmo dia-do-mês (clampado em meses curtos) e horário todo mês. */
export function buildMonthlyOccurrences(
  first: Occurrence,
  timezone: string,
  months: number = MONTHLY_OCCURRENCES_AHEAD,
): Occurrence[] {
  const result: Occurrence[] = []
  for (let i = 0; i < months; i += 1) {
    result.push(i === 0 ? { ...first } : shiftOccurrenceByMonths(first, i, timezone))
  }
  return result
}

/**
 * Série personalizada: mais de um dia da semana (ex.: cliente com 2x/semana
 * — segunda e quinta). `days` = dias da semana atendidos; a primeira
 * ocorrência já entra na lista (seu dia da semana não precisa estar em
 * `days`, mas normalmente está). Gera `weeksAhead` semanas, um horário por
 * dia selecionado, sempre no mesmo horário local da primeira ocorrência.
 */
export function buildCustomOccurrences(
  first: Occurrence,
  timezone: string,
  days: Weekday[],
  weeksAhead: number = RECURRENCE_WEEKS_AHEAD,
): Occurrence[] {
  const firstLocalDate = localDateString(new Date(first.starts_at), timezone)
  const firstWeekday = weekdayOfDateString(firstLocalDate)
  const firstIdx = WEEKDAY_ORDER.indexOf(firstWeekday)
  const uniqueDays = [...new Set(days.length > 0 ? days : [firstWeekday])]
  const sortedDays = uniqueDays.sort((a, b) => WEEKDAY_ORDER.indexOf(a) - WEEKDAY_ORDER.indexOf(b))

  const result: Occurrence[] = []
  for (let week = 0; week < weeksAhead; week += 1) {
    for (const day of sortedDays) {
      const dayOffset = WEEKDAY_ORDER.indexOf(day) - firstIdx
      const totalDaysAhead = week * 7 + dayOffset
      if (totalDaysAhead < 0) continue // dias da semana 0 anteriores à primeira ocorrência não existem
      result.push(totalDaysAhead === 0 ? { ...first } : shiftOccurrenceByDays(first, totalDaysAhead, timezone))
    }
  }
  return result.sort((a, b) => a.starts_at.localeCompare(b.starts_at))
}

/** Gera o horizonte de ocorrências de uma série, despachando pro gerador certo por tipo. */
export function buildRecurringOccurrences(
  first: Occurrence,
  timezone: string,
  recurrence: RecurrenceType,
  days?: Weekday[],
): Occurrence[] {
  switch (recurrence) {
    case 'weekly':
      return buildWeeklyOccurrences(first, timezone)
    case 'biweekly':
      return buildBiweeklyOccurrences(first, timezone)
    case 'monthly':
      return buildMonthlyOccurrences(first, timezone)
    case 'custom':
      return buildCustomOccurrences(first, timezone, days ?? [])
  }
}

/**
 * Próxima ocorrência depois da última da série (usado ao concluir um
 * atendimento pra estender a série em +1 — ver calendar-view.handleComplete).
 * Pra 'custom', cada dia da semana escolhido é sua própria subsérie semanal:
 * estender +1 semana a partir da última ocorrência DAQUELE dia reproduz o
 * padrão corretamente, sem precisar saber os outros dias da série.
 */
export function nextOccurrenceAfter(last: Occurrence, timezone: string, recurrence: RecurrenceType): Occurrence {
  switch (recurrence) {
    case 'weekly':
    case 'custom':
      return shiftOccurrenceByWeeks(last, 1, timezone)
    case 'biweekly':
      return shiftOccurrenceByWeeks(last, 2, timezone)
    case 'monthly':
      return shiftOccurrenceByMonths(last, 1, timezone)
  }
}
