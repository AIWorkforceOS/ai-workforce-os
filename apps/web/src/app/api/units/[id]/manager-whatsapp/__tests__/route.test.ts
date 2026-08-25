import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'

function makeRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/units/unit-1/manager-whatsapp', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function loadRoute(supabase: unknown) {
  vi.doMock('@/lib/supabase/server', () => ({ createClient: async () => supabase }))
  return import('../route')
}

describe('PATCH /api/units/[id]/manager-whatsapp', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('401 sem sessão autenticada', async () => {
    const { supabase } = createFakeSupabase({})
    Object.assign(supabase, { auth: { getUser: async () => ({ data: { user: null } }) } })
    const { PATCH } = await loadRoute(supabase)

    const res = await PATCH(makeRequest({ phone: '5511999998888' }), { params: Promise.resolve({ id: 'unit-1' }) })
    expect(res.status).toBe(401)
  })

  it('salva o telefone informado', async () => {
    const { supabase, db } = createFakeSupabase({ units: [{ id: 'unit-1', org_id: 'org-1', manager_whatsapp_phone: null }] })
    Object.assign(supabase, { auth: { getUser: async () => ({ data: { user: { id: 'auth-1', email: 'dono@empresa.com' } } }) } })
    const { PATCH } = await loadRoute(supabase)

    const res = await PATCH(makeRequest({ phone: '5511999998888' }), { params: Promise.resolve({ id: 'unit-1' }) })
    expect(res.status).toBe(200)
    expect((db.units as Array<Record<string, unknown>>)[0]!.manager_whatsapp_phone).toBe('5511999998888')
  })

  it('phone vazio/ausente limpa o campo (desativa a notificação)', async () => {
    const { supabase, db } = createFakeSupabase({ units: [{ id: 'unit-1', org_id: 'org-1', manager_whatsapp_phone: '5511999998888' }] })
    Object.assign(supabase, { auth: { getUser: async () => ({ data: { user: { id: 'auth-1', email: 'dono@empresa.com' } } }) } })
    const { PATCH } = await loadRoute(supabase)

    const res = await PATCH(makeRequest({ phone: '' }), { params: Promise.resolve({ id: 'unit-1' }) })
    expect(res.status).toBe(200)
    expect((db.units as Array<Record<string, unknown>>)[0]!.manager_whatsapp_phone).toBeNull()
  })
})
