import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'

function authedSupabase(overrides: Parameters<typeof createFakeSupabase>[0] = {}) {
  const { supabase, db } = createFakeSupabase(overrides)
  Object.assign(supabase, { auth: { getUser: async () => ({ data: { user: { id: 'auth-1', email: 'dono@mawipro.com' } } }) } })
  return { supabase, db }
}

async function loadRoute(supabase: unknown) {
  vi.doMock('@/lib/supabase/server', () => ({ createClient: async () => supabase }))
  return import('../route')
}

function makeRequest(body: Record<string, unknown>) {
  return new Request('http://localhost', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}

describe('PATCH /api/units/[id]/facilit/orders/[orderId]', () => {
  beforeEach(() => vi.resetModules())

  it('401 sem sessão', async () => {
    const { supabase } = createFakeSupabase({})
    Object.assign(supabase, { auth: { getUser: async () => ({ data: { user: null } }) } })
    const { PATCH } = await loadRoute(supabase)

    const res = await PATCH(makeRequest({ employeeId: 'emp-1' }), { params: Promise.resolve({ id: 'unit-1', orderId: 'wo-1' }) })
    expect(res.status).toBe(401)
  })

  it('atribui o técnico à ordem', async () => {
    const { supabase, db } = authedSupabase({
      facilit_work_orders: [{ id: 'wo-1', unit_id: 'unit-1', org_id: 'org-1', facilit_order_number: '1', assigned_employee_id: null }],
    })
    const { PATCH } = await loadRoute(supabase)

    const res = await PATCH(makeRequest({ employeeId: 'emp-1' }), { params: Promise.resolve({ id: 'unit-1', orderId: 'wo-1' }) })

    expect(res.status).toBe(200)
    expect(db.facilit_work_orders?.[0]).toMatchObject({ assigned_employee_id: 'emp-1', assigned_by: 'auth-1' })
  })

  it('employeeId null limpa a atribuição', async () => {
    const { supabase, db } = authedSupabase({
      facilit_work_orders: [{ id: 'wo-1', unit_id: 'unit-1', org_id: 'org-1', facilit_order_number: '1', assigned_employee_id: 'emp-1' }],
    })
    const { PATCH } = await loadRoute(supabase)

    const res = await PATCH(makeRequest({ employeeId: null }), { params: Promise.resolve({ id: 'unit-1', orderId: 'wo-1' }) })

    expect(res.status).toBe(200)
    expect(db.facilit_work_orders?.[0]?.assigned_employee_id).toBeNull()
  })

  it('500 quando a ordem não existe/não pertence à unidade', async () => {
    const { supabase } = authedSupabase({ facilit_work_orders: [] })
    const { PATCH } = await loadRoute(supabase)

    const res = await PATCH(makeRequest({ employeeId: 'emp-1' }), { params: Promise.resolve({ id: 'unit-1', orderId: 'wo-inexistente' }) })
    expect(res.status).toBe(500)
  })
})
