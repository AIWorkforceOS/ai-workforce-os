import { describe, expect, it } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'
import { runKaiSupervisor } from '../supervisor'

describe('runKaiSupervisor', () => {
  it('transforma falhas críticas em tarefas idempotentes', async () => {
    const { supabase, db } = createFakeSupabase({
      system_events: [{
        id: 'event-1', org_id: 'org-1', unit_id: 'unit-1', level: 'error', source: 'checkout',
        event_type: 'payment_charge_failed', message: 'Falha na cobrança', metadata: {},
        created_at: '2026-11-15T12:00:00.000Z',
      }],
      agent_configs: [],
      kai_tasks: [],
    })
    const result = await runKaiSupervisor(supabase, new Date('2026-11-15T12:05:00.000Z'))
    expect(result).toEqual({ scanned: 1, uncertified: 0, created: 1 })
    expect(db.kai_tasks?.[0]).toMatchObject({
      dedupe_key: 'system_event:event-1', priority: 'critical', owner: 'kai',
    })
  })

  it('abre pendência crítica sem desligar funcionário legado', async () => {
    const { supabase, db } = createFakeSupabase({
      system_events: [],
      agent_configs: [{
        id: 'config-1', unit_id: 'unit-1', agent_type: 'receptionist',
        is_active: true, certification_status: 'requires_review',
      }],
      units: [{ id: 'unit-1', org_id: 'org-1' }],
      kai_tasks: [],
    })

    const result = await runKaiSupervisor(supabase, new Date('2026-11-15T12:05:00.000Z'))

    expect(result).toEqual({ scanned: 0, uncertified: 1, created: 1 })
    expect(db.agent_configs?.[0]?.is_active).toBe(true)
    expect(db.kai_tasks?.[0]).toMatchObject({
      org_id: 'org-1', dedupe_key: 'agent_certification:config-1', status: 'waiting_human', priority: 'critical',
    })
  })
})
