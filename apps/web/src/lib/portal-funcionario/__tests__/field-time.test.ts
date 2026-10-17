import { describe, expect, it } from 'vitest'
import { canFinalizeOrder, computeDurations, fieldState, formatDuration, isFieldEventType, mapsLink } from '../field-time'

const E = (t: string | null, c: string | null, w: string | null) => ({ trip_started_at: t, checked_in_at: c, work_ended_at: w })

describe('fieldState', () => {
  it('segue a sequência viagem → no local → concluído', () => {
    expect(fieldState(E(null, null, null))).toBe('not_started')
    expect(fieldState(E('2026-10-17T10:00:00Z', null, null))).toBe('on_trip')
    expect(fieldState(E('2026-10-17T10:00:00Z', '2026-10-17T10:30:00Z', null))).toBe('on_site')
    expect(fieldState(E('2026-10-17T10:00:00Z', '2026-10-17T10:30:00Z', '2026-10-17T11:30:00Z'))).toBe('done')
    expect(fieldState(E(null, '2026-10-17T10:30:00Z', null))).toBe('on_site') // check-in direto, sem viagem
  })
})

describe('computeDurations', () => {
  const now = Date.parse('2026-10-17T12:00:00Z')
  it('viagem = início→check-in; serviço = check-in→fim', () => {
    const d = computeDurations(E('2026-10-17T10:00:00Z', '2026-10-17T10:30:00Z', '2026-10-17T11:45:00Z'), now)
    expect(d.tripMs).toBe(30 * 60_000)
    expect(d.serviceMs).toBe(75 * 60_000)
    expect(d.totalMs).toBe(105 * 60_000)
  })
  it('o que ainda está correndo usa o "agora"', () => {
    expect(computeDurations(E('2026-10-17T11:00:00Z', null, null), now).tripMs).toBe(60 * 60_000)
    expect(computeDurations(E('2026-10-17T11:00:00Z', '2026-10-17T11:20:00Z', null), now).serviceMs).toBe(40 * 60_000)
  })
  it('sem nenhum marco não inventa tempo', () => {
    expect(computeDurations(E(null, null, null), now)).toEqual({ tripMs: null, serviceMs: null, totalMs: null })
  })
  it('nunca negativo (relógio do aparelho adiantado)', () => {
    expect(computeDurations(E('2026-10-17T13:00:00Z', null, null), now).tripMs).toBe(0)
  })
})

describe('formatDuration', () => {
  it('formata h/min/s', () => {
    expect(formatDuration(3725000)).toBe('1h 02min 05s')
    expect(formatDuration(125000)).toBe('02min 05s')
    expect(formatDuration(5000)).toBe('05s')
    expect(formatDuration(null)).toBe('—')
  })
})

describe('regras', () => {
  it('check-in obrigatório só para quem o admin marcou', () => {
    expect(canFinalizeOrder(false, null)).toBe(true)
    expect(canFinalizeOrder(true, null)).toBe(false)
    expect(canFinalizeOrder(true, '2026-10-17T10:30:00Z')).toBe(true)
  })
  it('tipos de evento e link do mapa', () => {
    expect(isFieldEventType('trip_start')).toBe(true)
    expect(isFieldEventType('drop table')).toBe(false)
    expect(mapsLink(25.77, -80.19)).toBe('https://www.google.com/maps?q=25.77,-80.19')
    expect(mapsLink(null, null)).toBeNull()
  })
})
