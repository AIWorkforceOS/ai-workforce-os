import { describe, expect, it } from 'vitest'
import { dayKeyInTimezone, groupAppointmentsByTodayTomorrow } from '../agenda-grouping'

describe('dayKeyInTimezone', () => {
  it('formata o dia local no fuso da unidade, não no fuso do processo', () => {
    // 02:30 UTC ainda é 23:30 do dia anterior em Nova York (UTC-3 no horário de verão local em agosto).
    expect(dayKeyInTimezone('2026-08-06T02:30:00Z', 'America/New_York')).toBe('2026-08-05')
    expect(dayKeyInTimezone('2026-08-06T02:30:00Z', 'UTC')).toBe('2026-08-06')
  })
})

describe('groupAppointmentsByTodayTomorrow', () => {
  const timezone = 'America/Sao_Paulo'
  const todayKey = new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date())

  function isoAt(dayOffset: number, hour: string): string {
    const [y = 0, m = 1, d = 1] = todayKey.split('-').map(Number)
    const base = new Date(Date.UTC(y, m - 1, d))
    base.setUTCDate(base.getUTCDate() + dayOffset)
    const dateStr = base.toISOString().slice(0, 10)
    return `${dateStr}T${hour}:00-03:00`
  }

  it('separa em hoje e amanhã, ignorando outras datas', () => {
    const appointments = [
      { id: 'today-1', starts_at: isoAt(0, '09:00') },
      { id: 'today-2', starts_at: isoAt(0, '15:00') },
      { id: 'tomorrow-1', starts_at: isoAt(1, '10:00') },
      { id: 'yesterday', starts_at: isoAt(-1, '10:00') },
      { id: 'next-week', starts_at: isoAt(7, '10:00') },
    ]

    const result = groupAppointmentsByTodayTomorrow(appointments, timezone)

    expect(result.today.map((a) => a.id)).toEqual(['today-1', 'today-2'])
    expect(result.tomorrow.map((a) => a.id)).toEqual(['tomorrow-1'])
  })

  it('devolve listas vazias quando não há nada hoje nem amanhã', () => {
    const appointments = [{ id: 'far-off', starts_at: isoAt(30, '10:00') }]

    const result = groupAppointmentsByTodayTomorrow(appointments, timezone)

    expect(result.today).toEqual([])
    expect(result.tomorrow).toEqual([])
  })

  it('mantém a ordem original dentro de cada grupo', () => {
    const appointments = [
      { id: 'b', starts_at: isoAt(0, '15:00') },
      { id: 'a', starts_at: isoAt(0, '09:00') },
    ]

    const result = groupAppointmentsByTodayTomorrow(appointments, timezone)

    expect(result.today.map((a) => a.id)).toEqual(['b', 'a'])
  })
})
