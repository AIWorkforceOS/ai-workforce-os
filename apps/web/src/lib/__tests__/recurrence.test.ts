import { describe, expect, it } from 'vitest'
import {
  buildBiweeklyOccurrences,
  buildCustomOccurrences,
  buildMonthlyOccurrences,
  buildRecurringOccurrences,
  buildWeeklyOccurrences,
  nextOccurrenceAfter,
  shiftOccurrenceByMonths,
  shiftOccurrenceByWeeks,
} from '@/lib/scheduling/recurrence'
import { localDateString } from '@/lib/slot-engine'

const SP = 'America/Sao_Paulo'
const NY = 'America/New_York'

describe('buildWeeklyOccurrences', () => {
  it('gera N ocorrências, uma por semana, mantendo horário e duração', () => {
    // Quarta 2026-07-22 10:00–12:00 em São Paulo (UTC-3) = 13:00Z–15:00Z
    const first = { starts_at: '2026-07-22T13:00:00.000Z', ends_at: '2026-07-22T15:00:00.000Z' }
    const occurrences = buildWeeklyOccurrences(first, SP, 4)

    expect(occurrences).toHaveLength(4)
    expect(occurrences[0]).toEqual(first)
    expect(occurrences[1]!.starts_at).toBe('2026-07-29T13:00:00.000Z')
    expect(occurrences[3]!.starts_at).toBe('2026-08-12T13:00:00.000Z')
    for (const occ of occurrences) {
      // duração preservada (2h)
      expect(new Date(occ.ends_at).getTime() - new Date(occ.starts_at).getTime()).toBe(2 * 60 * 60 * 1000)
      // sempre o mesmo dia da semana no fuso da unidade
      expect(new Date(occ.starts_at).getUTCDay()).toBe(3)
    }
  })

  it('preserva o horário LOCAL ao cruzar a virada de horário de verão', () => {
    // Quarta 2026-10-28 10:00 em New York (EDT, UTC-4) = 14:00Z.
    // Em 2026-11-04 já é EST (UTC-5): 10:00 local = 15:00Z.
    const first = { starts_at: '2026-10-28T14:00:00.000Z', ends_at: '2026-10-28T16:00:00.000Z' }
    const occurrences = buildWeeklyOccurrences(first, NY, 2)

    expect(occurrences[1]!.starts_at).toBe('2026-11-04T15:00:00.000Z')
    expect(localDateString(new Date(occurrences[1]!.starts_at), NY)).toBe('2026-11-04')
  })
})

describe('shiftOccurrenceByWeeks', () => {
  it('desloca uma ocorrência isolada em N semanas (usado pra estender a série)', () => {
    const base = { starts_at: '2026-07-22T13:00:00.000Z', ends_at: '2026-07-22T14:30:00.000Z' }
    const next = shiftOccurrenceByWeeks(base, 1, SP)
    expect(next.starts_at).toBe('2026-07-29T13:00:00.000Z')
    expect(next.ends_at).toBe('2026-07-29T14:30:00.000Z')
  })
})

describe('buildBiweeklyOccurrences', () => {
  it('gera ocorrências a cada 2 semanas', () => {
    const first = { starts_at: '2026-07-22T13:00:00.000Z', ends_at: '2026-07-22T15:00:00.000Z' }
    const occurrences = buildBiweeklyOccurrences(first, SP, 3)
    expect(occurrences).toHaveLength(3)
    expect(occurrences[0]).toEqual(first)
    expect(occurrences[1]!.starts_at).toBe('2026-08-05T13:00:00.000Z')
    expect(occurrences[2]!.starts_at).toBe('2026-08-19T13:00:00.000Z')
  })
})

describe('buildMonthlyOccurrences / shiftOccurrenceByMonths', () => {
  it('gera ocorrências no mesmo dia do mês, preservando horário', () => {
    // Quarta 2026-07-22 10:00 em São Paulo = 13:00Z
    const first = { starts_at: '2026-07-22T13:00:00.000Z', ends_at: '2026-07-22T15:00:00.000Z' }
    const occurrences = buildMonthlyOccurrences(first, SP, 3)
    expect(occurrences).toHaveLength(3)
    expect(localDateString(new Date(occurrences[1]!.starts_at), SP)).toBe('2026-08-22')
    expect(localDateString(new Date(occurrences[2]!.starts_at), SP)).toBe('2026-09-22')
  })

  it('clampa o dia em meses mais curtos (31/jan -> 28 ou 29/fev)', () => {
    // 2026-01-31 10:00 em São Paulo = 13:00Z
    const base = { starts_at: '2026-01-31T13:00:00.000Z', ends_at: '2026-01-31T14:00:00.000Z' }
    const next = shiftOccurrenceByMonths(base, 1, SP)
    expect(localDateString(new Date(next.starts_at), SP)).toBe('2026-02-28')
  })
})

describe('buildCustomOccurrences', () => {
  it('gera uma ocorrência por dia da semana escolhido, mesma semana em diante', () => {
    // Segunda 2026-07-20 09:00 em São Paulo = 12:00Z; dias escolhidos: seg e qui
    const first = { starts_at: '2026-07-20T12:00:00.000Z', ends_at: '2026-07-20T13:00:00.000Z' }
    const occurrences = buildCustomOccurrences(first, SP, ['mon', 'thu'], 2)

    expect(occurrences).toHaveLength(4)
    const dates = occurrences.map((o) => localDateString(new Date(o.starts_at), SP))
    expect(dates).toEqual(['2026-07-20', '2026-07-23', '2026-07-27', '2026-07-30'])
    for (const occ of occurrences) {
      expect(new Date(occ.ends_at).getTime() - new Date(occ.starts_at).getTime()).toBe(60 * 60 * 1000)
    }
  })

  it('ignora dias da semana 0 anteriores à primeira ocorrência', () => {
    // Quinta 2026-07-23; dias escolhidos: seg e qui — segunda dessa semana já passou
    const first = { starts_at: '2026-07-23T12:00:00.000Z', ends_at: '2026-07-23T13:00:00.000Z' }
    const occurrences = buildCustomOccurrences(first, SP, ['mon', 'thu'], 2)
    const dates = occurrences.map((o) => localDateString(new Date(o.starts_at), SP))
    expect(dates).toEqual(['2026-07-23', '2026-07-27', '2026-07-30'])
  })
})

describe('buildRecurringOccurrences', () => {
  it('despacha pro gerador certo por tipo', () => {
    const first = { starts_at: '2026-07-22T13:00:00.000Z', ends_at: '2026-07-22T15:00:00.000Z' }
    expect(buildRecurringOccurrences(first, SP, 'weekly')).toHaveLength(12)
    expect(buildRecurringOccurrences(first, SP, 'biweekly')).toHaveLength(6)
    expect(buildRecurringOccurrences(first, SP, 'monthly')).toHaveLength(3)
    expect(buildRecurringOccurrences(first, SP, 'custom', ['wed', 'fri'])).toHaveLength(24)
  })
})

describe('nextOccurrenceAfter', () => {
  const base = { starts_at: '2026-07-22T13:00:00.000Z', ends_at: '2026-07-22T14:00:00.000Z' }

  it('weekly e custom estendem em +1 semana', () => {
    expect(nextOccurrenceAfter(base, SP, 'weekly').starts_at).toBe('2026-07-29T13:00:00.000Z')
    expect(nextOccurrenceAfter(base, SP, 'custom').starts_at).toBe('2026-07-29T13:00:00.000Z')
  })

  it('biweekly estende em +2 semanas', () => {
    expect(nextOccurrenceAfter(base, SP, 'biweekly').starts_at).toBe('2026-08-05T13:00:00.000Z')
  })

  it('monthly estende em +1 mês', () => {
    expect(localDateString(new Date(nextOccurrenceAfter(base, SP, 'monthly').starts_at), SP)).toBe('2026-08-22')
  })
})
