import { localDateString, zonedTimeToUtc } from '@/lib/slot-engine'
import { addDays } from '@/lib/calendar-dates'

/**
 * Recorrência semanal simples (migration 032) — decisão de escopo:
 * NÃO é RRULE de calendário. "Recorrente" aqui significa "toda semana,
 * no mesmo dia da semana e horário LOCAL da unidade, até cancelar".
 *
 * As ocorrências são linhas reais em `appointments`, todas com
 * recurrence = 'weekly' e o mesmo recurrence_group_id:
 *   - na criação da série geramos as próximas RECURRENCE_WEEKS_AHEAD
 *     semanas de uma vez;
 *   - a cada ocorrência CONCLUÍDA no calendário, penduramos +1 semana no
 *     fim da série (ver calendar-view.handleComplete) — assim uma série
 *     em uso nunca "acaba", sem precisar de cron novo.
 *
 * O horário é preservado no fuso da unidade (10:00 continua 10:00 mesmo
 * cruzando virada de horário de verão), por isso a conta é feita em
 * data/hora local (zonedTimeToUtc), nunca somando 7×24h no instante UTC.
 */
export const RECURRENCE_WEEKS_AHEAD = 12

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

/** Ocorrência `weeksAhead` semanas depois, mesmo horário local e mesma duração. */
export function shiftOccurrenceByWeeks(
  base: Occurrence,
  weeksAhead: number,
  timezone: string,
): Occurrence {
  const startInstant = new Date(base.starts_at)
  const durationMs = new Date(base.ends_at).getTime() - startInstant.getTime()
  const localDate = localDateString(startInstant, timezone)
  const localTime = localTimeString(startInstant, timezone)
  const starts = zonedTimeToUtc(addDays(localDate, weeksAhead * 7), localTime, timezone)
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
