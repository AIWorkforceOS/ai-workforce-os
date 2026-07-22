import { describe, expect, it } from 'vitest'
import { buildWeeklyOccurrences, shiftOccurrenceByWeeks } from '@/lib/scheduling/recurrence'
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
