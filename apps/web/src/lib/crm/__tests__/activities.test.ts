import { describe, expect, it } from 'vitest'
import { dayInZone, dueBucket, dueCounts, nextDueByLead, openItems, validateNewActivity } from '../activities'

const TZ = 'America/New_York'
const now = new Date('2026-10-26T15:00:00Z') // 11:00 em Nova York

describe('dueBucket', () => {
  it('classifica pelo dia no fuso da unidade', () => {
    expect(dueBucket('2026-10-25T20:00:00Z', now, TZ)).toBe('overdue')
    expect(dueBucket('2026-10-26T13:00:00Z', now, TZ)).toBe('today') // 09:00 de hoje (já passou, mas é hoje)
    expect(dueBucket('2026-10-26T23:00:00Z', now, TZ)).toBe('today')
    expect(dueBucket('2026-10-27T15:00:00Z', now, TZ)).toBe('upcoming')
  })
  it('usa o fuso: 01:00 UTC do dia 27 ainda é dia 26 em Nova York', () => {
    expect(dayInZone('2026-10-27T01:00:00Z', TZ)).toBe('2026-10-26')
    expect(dueBucket('2026-10-27T01:00:00Z', now, TZ)).toBe('today')
  })
})

describe('nextDueByLead / dueCounts', () => {
  const items = [
    { id: '1', lead_id: 'A', kind: 'followup' as const, due_at: '2026-10-28T15:00:00Z', done_at: null },
    { id: '2', lead_id: 'A', kind: 'task' as const, due_at: '2026-10-25T15:00:00Z', done_at: null },
    { id: '3', lead_id: 'B', kind: 'followup' as const, due_at: '2026-10-26T20:00:00Z', done_at: null },
    { id: '4', lead_id: 'C', kind: 'followup' as const, due_at: '2026-10-20T20:00:00Z', done_at: '2026-10-21T10:00:00Z' },
    { id: '5', lead_id: 'D', kind: 'note' as const, due_at: null, done_at: null },
  ]
  it('ignora concluídos e notas; pega o prazo mais próximo por lead', () => {
    expect(openItems(items)).toHaveLength(3)
    const next = nextDueByLead(items, now, TZ)
    expect([...next.keys()].sort()).toEqual(['A', 'B'])
    expect(next.get('A')?.bucket).toBe('overdue')
    expect(next.get('B')?.bucket).toBe('today')
    expect(dueCounts(next)).toEqual({ overdue: 1, today: 1 })
  })
})

describe('validateNewActivity', () => {
  it('exige data no retorno e texto nas notas', () => {
    expect(validateNewActivity({ kind: 'followup', body: '', dueAt: '' })).toMatch(/data/i)
    expect(validateNewActivity({ kind: 'followup', body: '', dueAt: '2026-10-27T10:00' })).toBeNull()
    expect(validateNewActivity({ kind: 'note', body: '  ', dueAt: '' })).toMatch(/escreva/i)
    expect(validateNewActivity({ kind: 'call', body: 'falei com o gerente', dueAt: '' })).toBeNull()
    expect(validateNewActivity({ kind: 'note', body: 'x'.repeat(2001), dueAt: '' })).toMatch(/longo/i)
  })
})
