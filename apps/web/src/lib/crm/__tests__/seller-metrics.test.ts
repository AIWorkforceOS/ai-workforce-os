import { describe, expect, it } from 'vitest'
import { sellerMetrics, totalsOf } from '../seller-metrics'

const NOW = new Date('2026-10-26T15:00:00Z')
const TZ = 'America/New_York'
const users = [{ id: 'u1', name: 'Ana', email: 'ana@x.com' }, { id: 'u2', name: null, email: 'beto@x.com' }]
const lead = (id: string, status: string, owner: string | null, extra = {}) => ({ id, status, owner_user_id: owner, created_at: '2026-10-20T10:00:00Z', updated_at: '2026-10-24T10:00:00Z', unit_id: 'un', ...extra })
const act = (lead_id: string, kind: string, by: string | null, extra = {}) => ({ lead_id, kind, created_by: by, created_at: '2026-10-25T10:00:00Z', due_at: null, done_at: null, ...extra })

describe('sellerMetrics', () => {
  const leads = [lead('a', 'won', 'u1'), lead('b', 'negotiating', 'u1'), lead('c', 'lost', 'u1'), lead('d', 'new', 'u2'), lead('e', 'contacted', null), lead('f', 'won', 'u2', { updated_at: '2026-08-01T10:00:00Z', created_at: '2026-07-01T10:00:00Z' })]
  const activities = [
    act('b', 'call', 'u1'), act('b', 'message', 'u1'), act('b', 'note', 'u1'),
    act('d', 'call', 'u2', { created_at: '2026-06-01T10:00:00Z' }), // fora do período
    act('b', 'followup', 'u1', { due_at: '2026-10-20T15:00:00Z' }), // atrasado, lead de u1
    act('e', 'followup', 'u2', { due_at: '2026-10-21T15:00:00Z' }), // atrasado, lead sem responsável
    act('b', 'task', 'u1', { due_at: '2026-10-22T15:00:00Z', done_at: '2026-10-25T09:00:00Z' }), // feito no período
  ]
  const rows = sellerMetrics({ leads, activities, users, now: NOW, days: 30, timeZone: TZ })
  const by = (id: string | null) => rows.find((r) => r.userId === id)!

  it('conta leads, convertidos e taxa por responsável', () => {
    expect(by('u1')).toMatchObject({ assigned: 3, active: 1, won: 1, lost: 1, conversionRate: 33, wonInPeriod: 1 })
    expect(by('u2')).toMatchObject({ assigned: 2, won: 1, wonInPeriod: 0, newInPeriod: 1, conversionRate: 50 })
    expect(by(null)).toMatchObject({ assigned: 1, active: 1 })
  })
  it('atividade por quem registrou, só no período', () => {
    expect(by('u1')).toMatchObject({ calls: 1, messages: 1, notes: 1, followupsDone: 1 })
    expect(by('u2')).toMatchObject({ calls: 0 })
  })
  it('retornos atrasados por responsável do lead; lead ativo sem registro no período conta como parado', () => {
    expect(by('u1').overdueFollowups).toBe(1)
    expect(by(null).overdueFollowups).toBe(1)
    expect(by('u1').untouched).toBe(0) // b teve atividade
    expect(by('u2').untouched).toBe(1) // d só tem atividade antiga
  })
  it('ordena por convertidos no período e omite "sem responsável" quando não há leads', () => {
    expect(rows[0]!.userId).toBe('u1')
    const none = sellerMetrics({ leads: [lead('a', 'new', 'u1')], activities: [], users, now: NOW, days: 7, timeZone: TZ })
    expect(none.find((r) => r.userId === null)).toBeUndefined()
    expect(totalsOf(rows)).toMatchObject({ assigned: 6, won: 2, overdueFollowups: 2 })
  })
})
