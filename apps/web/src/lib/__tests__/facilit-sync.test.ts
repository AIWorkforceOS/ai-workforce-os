import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { createFakeSupabase } from './fake-supabase'
import { syncFacilitOrdersForUnit, type FacilitCredentialRow } from '../facilit-sync'
import type { Unit } from '../types'

// Sync Facil-IT → facilit_work_orders (Mawi Pro, 2026-09-10): login novo a
// cada chamada (nunca cacheia token), upsert por (unit_id, número da
// ordem), nunca sobrescreve o técnico já atribuído numa ordem existente.

function makeUnit(overrides: Partial<Unit> = {}): Unit {
  return {
    id: 'unit-1',
    org_id: 'org-1',
    name: 'Mawi Pro — Principal',
    slug: 'mawi-pro-principal',
    timezone: 'America/Phoenix',
    is_active: true,
    ...overrides,
  } as Unit
}

function makeCredential(overrides: Partial<FacilitCredentialRow> = {}): FacilitCredentialRow {
  return {
    id: 'cred-1',
    org_id: 'org-1',
    unit_id: 'unit-1',
    client_code: 'CC1',
    username: 'user1',
    password: 'secret',
    is_active: true,
    ...overrides,
  }
}

describe('syncFacilitOrdersForUnit', () => {
  const originalFetch = global.fetch
  const NOW = new Date('2026-09-10T18:00:00Z') // ~11h da manhã em Phoenix (sem DST)

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    global.fetch = originalFetch
    vi.useRealTimers()
  })

  it('importa as ordens de hoje/amanhã e atualiza last_synced_at', async () => {
    global.fetch = vi.fn(async (url: unknown) => {
      const u = String(url)
      if (u.includes('/Login')) return new Response(JSON.stringify({ token: 'tok-123' }), { status: 200 })
      return new Response(
        JSON.stringify([
          { orderNumber: '158725-01', company: 'Walgreens', visitDate: '2026-09-10T20:00:00Z' },
          { orderNumber: '999999-01', company: 'Fora do prazo', visitDate: '2026-09-20T20:00:00Z' },
        ]),
        { status: 200 },
      )
    }) as typeof fetch

    const { supabase, db } = createFakeSupabase({
      facilit_credentials: [makeCredential()],
      facilit_work_orders: [],
    })

    const result = await syncFacilitOrdersForUnit(supabase, makeUnit(), makeCredential())

    expect(result).toEqual({ imported: 1, error: null })
    expect(db.facilit_work_orders).toHaveLength(1)
    expect(db.facilit_work_orders?.[0]).toMatchObject({ facilit_order_number: '158725-01', company: 'Walgreens' })
    expect(db.facilit_credentials?.[0]?.last_synced_at).toBeTruthy()
    expect(db.facilit_credentials?.[0]?.last_sync_error).toBeNull()
  })

  it('reimportar a mesma ordem atualiza os dados mas não mexe em assigned_employee_id já definido', async () => {
    global.fetch = vi.fn(async (url: unknown) => {
      const u = String(url)
      if (u.includes('/Login')) return new Response(JSON.stringify({ token: 'tok-123' }), { status: 200 })
      return new Response(JSON.stringify([{ orderNumber: '158725-01', status: 'In Progress', visitDate: '2026-09-10T20:00:00Z' }]), {
        status: 200,
      })
    }) as typeof fetch

    const { supabase, db } = createFakeSupabase({
      facilit_credentials: [makeCredential()],
      facilit_work_orders: [
        {
          id: 'wo-1',
          org_id: 'org-1',
          unit_id: 'unit-1',
          facilit_order_number: '158725-01',
          status: 'Scheduled',
          assigned_employee_id: 'emp-1',
        },
      ],
    })

    await syncFacilitOrdersForUnit(supabase, makeUnit(), makeCredential())

    expect(db.facilit_work_orders).toHaveLength(1)
    expect(db.facilit_work_orders?.[0]).toMatchObject({ status: 'In Progress', assigned_employee_id: 'emp-1' })
  })

  it('login falhando grava last_sync_error e loga facilit_sync_auth_failed, sem lançar', async () => {
    global.fetch = vi.fn(async () => new Response('', { status: 401 })) as typeof fetch

    const { supabase, db } = createFakeSupabase({
      facilit_credentials: [makeCredential()],
      facilit_work_orders: [],
    })

    const result = await syncFacilitOrdersForUnit(supabase, makeUnit(), makeCredential())

    expect(result.imported).toBe(0)
    expect(result.error).toBeTruthy()
    expect(db.facilit_credentials?.[0]?.last_sync_error).toBeTruthy()
    expect(db.system_events?.some((e) => e.event_type === 'facilit_sync_auth_failed')).toBe(true)
  })
})
