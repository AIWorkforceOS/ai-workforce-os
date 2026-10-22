import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'

async function load(appUser: unknown, supabase: unknown) {
  vi.resetModules()
  vi.doMock('@/lib/app-user', () => ({ getAppUser: async () => appUser }))
  vi.doMock('@/lib/supabase/server', () => ({ createClient: async () => supabase }))
  return import('../route')
}
const req = (b: unknown) => new Request('http://x', { method: 'PATCH', body: JSON.stringify(b) })
const params = { params: Promise.resolve({ id: 'u1', appointmentId: 'a1' }) }
const admin = { id: 'adm', role: 'admin' }
const seed = () => createFakeSupabase({ appointments: [{ id: 'a1', unit_id: 'u1', status: 'scheduled', intake_status: 'awaiting_accept' }] })

describe('PATCH intake-decision', () => {
  beforeEach(() => vi.resetModules())

  it('só administrador decide', async () => {
    for (const user of [null, { id: 'e', role: 'employee' }]) {
      const { PATCH } = await load(user, seed().supabase)
      expect([401, 403]).toContain((await PATCH(req({ decision: 'accept' }), params)).status)
    }
  })

  it('aceitar vira ordem normal; recusar cancela', async () => {
    const a = seed()
    let { PATCH } = await load(admin, a.supabase)
    expect((await PATCH(req({ decision: 'accept' }), params)).status).toBe(200)
    expect(a.db.appointments![0]).toMatchObject({ intake_status: null, intake_decided_by: 'adm', status: 'scheduled' })

    const b = seed()
    ;({ PATCH } = await load(admin, b.supabase))
    expect((await PATCH(req({ decision: 'refuse', reason: 'fora da área' }), params)).status).toBe(200)
    expect(b.db.appointments![0]).toMatchObject({ intake_status: 'refused', status: 'cancelled', cancellation_reason: 'fora da área' })
  })

  it('409 se a ordem já foi decidida', async () => {
    const a = seed()
    const { PATCH } = await load(admin, a.supabase)
    await PATCH(req({ decision: 'accept' }), params)
    expect((await PATCH(req({ decision: 'refuse' }), params)).status).toBe(409)
    expect(a.db.appointments![0]!.status).toBe('scheduled')
  })
})
