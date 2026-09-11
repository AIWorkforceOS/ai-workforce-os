import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'

const syncFacilitOrdersForUnit = vi.fn()

async function loadRoute(supabase: unknown) {
  vi.doMock('@/lib/supabase/server', () => ({ createClient: async () => supabase }))
  vi.doMock('@/lib/facilit-sync', () => ({ syncFacilitOrdersForUnit }))
  return import('../route')
}

function authedSupabase(overrides: Parameters<typeof createFakeSupabase>[0] = {}) {
  const { supabase, db } = createFakeSupabase(overrides)
  Object.assign(supabase, { auth: { getUser: async () => ({ data: { user: { id: 'auth-1', email: 'dono@mawipro.com' } } }) } })
  return { supabase, db }
}

describe('POST /api/units/[id]/facilit/sync', () => {
  beforeEach(() => {
    vi.resetModules()
    syncFacilitOrdersForUnit.mockReset()
  })

  afterEach(() => {
    vi.doUnmock('@/lib/facilit-sync')
  })

  it('401 sem sessão', async () => {
    const { supabase } = createFakeSupabase({})
    Object.assign(supabase, { auth: { getUser: async () => ({ data: { user: null } }) } })
    const { POST } = await loadRoute(supabase)

    const res = await POST(new Request('http://localhost', { method: 'POST' }), { params: Promise.resolve({ id: 'unit-1' }) })
    expect(res.status).toBe(401)
  })

  it('400 sem credencial cadastrada', async () => {
    const { supabase } = authedSupabase({ units: [{ id: 'unit-1', org_id: 'org-1', timezone: 'America/Phoenix' }] })
    const { POST } = await loadRoute(supabase)

    const res = await POST(new Request('http://localhost', { method: 'POST' }), { params: Promise.resolve({ id: 'unit-1' }) })
    expect(res.status).toBe(400)
    expect(syncFacilitOrdersForUnit).not.toHaveBeenCalled()
  })

  it('sincroniza e devolve o total importado', async () => {
    syncFacilitOrdersForUnit.mockResolvedValue({ imported: 2, error: null })
    const { supabase } = authedSupabase({
      units: [{ id: 'unit-1', org_id: 'org-1', timezone: 'America/Phoenix' }],
      facilit_credentials: [{ id: 'cred-1', unit_id: 'unit-1', org_id: 'org-1', client_code: 'CC1', username: 'u', password: 'p', is_active: true }],
    })
    const { POST } = await loadRoute(supabase)

    const res = await POST(new Request('http://localhost', { method: 'POST' }), { params: Promise.resolve({ id: 'unit-1' }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ ok: true, imported: 2 })
  })

  it('502 quando o sync falha (ex.: login rejeitado)', async () => {
    syncFacilitOrdersForUnit.mockResolvedValue({ imported: 0, error: 'Login na Facil-IT falhou' })
    const { supabase } = authedSupabase({
      units: [{ id: 'unit-1', org_id: 'org-1', timezone: 'America/Phoenix' }],
      facilit_credentials: [{ id: 'cred-1', unit_id: 'unit-1', org_id: 'org-1', client_code: 'CC1', username: 'u', password: 'p', is_active: true }],
    })
    const { POST } = await loadRoute(supabase)

    const res = await POST(new Request('http://localhost', { method: 'POST' }), { params: Promise.resolve({ id: 'unit-1' }) })
    expect(res.status).toBe(502)
  })
})
