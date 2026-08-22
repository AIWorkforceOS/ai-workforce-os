import { describe, expect, it } from 'vitest'
import { toActivityItems } from '@/components/dashboard/conversation-activity-timeline'
import type { SystemEvent } from '@/lib/system-events'

function event(overrides: Partial<SystemEvent> = {}): SystemEvent {
  return {
    id: 'evt-1',
    org_id: 'org-1',
    unit_id: 'unit-1',
    lead_id: null,
    level: 'info',
    source: 'system',
    event_type: 'unknown_event',
    message: 'mensagem',
    metadata: {},
    created_at: '2026-08-19T12:00:00.000Z',
    ...overrides,
  }
}

describe('toActivityItems', () => {
  it('classifica intervenção humana e devolução', () => {
    const items = toActivityItems([
      event({ event_type: 'human_operator_message' }),
      event({ event_type: 'human_intervention_released' }),
    ])
    expect(items.map((i) => i.kind)).toEqual(['human', 'human'])
    expect(items[0]!.label).toBe('Atendimento assumido manualmente')
    expect(items[1]!.label).toBe('Devolvido à automação')
  })

  it('classifica handoffs de vários formatos de event_type', () => {
    const items = toActivityItems([
      event({ event_type: 'receptionist_handoff_sales' }),
      event({ event_type: 'job.handed_off' }),
      event({ event_type: 'sales_handoff_recruiter_inactive' }),
    ])
    expect(items.every((i) => i.kind === 'handoff')).toBe(true)
  })

  it('classifica falhas por sufixo _failed ou level=error', () => {
    const items = toActivityItems([
      event({ event_type: 'follow_up_send_failed' }),
      event({ event_type: 'algo_qualquer', level: 'error' }),
    ])
    expect(items.every((i) => i.kind === 'failure')).toBe(true)
  })

  it('classifica escalação por conter "escalat" no event_type', () => {
    const items = toActivityItems([event({ event_type: 'job.escalated' })])
    expect(items[0]!.kind).toBe('escalation')
  })

  it('cai em "action" pra tipos de evento não classificados', () => {
    const items = toActivityItems([event({ event_type: 'deal_won' })])
    expect(items[0]!.kind).toBe('action')
    expect(items[0]!.label).toBe('Negócio fechado')
  })

  it('tipo de evento sem rótulo conhecido ainda fica legível (não mostra snake_case cru)', () => {
    const items = toActivityItems([event({ event_type: 'algo_nunca_visto_antes' })])
    expect(items[0]!.label).toBe('algo nunca visto antes')
  })

  it('preserva ordem, id e timestamp do evento original', () => {
    const items = toActivityItems([event({ id: 'evt-42', created_at: '2026-08-19T15:30:00.000Z' })])
    expect(items[0]).toMatchObject({ id: 'evt-42', createdAt: '2026-08-19T15:30:00.000Z' })
  })
})
