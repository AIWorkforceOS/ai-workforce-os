import { beforeEach, describe, expect, it, vi } from 'vitest'

/** Liberar a troca de logo: SÓ o super admin Alizo, e só para o administrador de uma empresa. */
type User = { id: string; role: string; isSuperAdmin: boolean; orgId: string | null }
let current: User | null = null
let target: { id: string; role: string; org_id: string | null; email: string } | null = null
const updates: { payload: Record<string, unknown>; id: unknown }[] = []

vi.mock('@/lib/app-user', () => ({ getAppUser: async () => current }))
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: () => {
      const state: { payload?: Record<string, unknown>; id?: unknown } = {}
      const q: Record<string, unknown> = {}
      Object.assign(q, {
        select: () => q,
        eq: (_c: string, v: unknown) => { state.id = v; return q },
        update: (p: Record<string, unknown>) => { state.payload = p; return q },
        maybeSingle: async () => ({ data: target, error: null }),
        then: (resolve: (v: unknown) => void) => { if (state.payload) updates.push({ payload: state.payload, id: state.id }); resolve({ error: null }) },
      })
      return q
    },
  }),
}))

async function patch(body: unknown) {
  const { PATCH } = await import('../route')
  const res = await PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify(body) }))
  return { status: res.status, body: (await res.json()) as { ok?: boolean; error?: string; enabled?: boolean } }
}

beforeEach(() => {
  current = { id: 'sa', role: 'super_admin', isSuperAdmin: true, orgId: null }
  target = { id: 'vinny', role: 'admin', org_id: 'org-mawi', email: 'vinny29lp@gmail.com' }
  updates.length = 0
})

describe('PATCH /api/admin/users/branding-access', () => {
  it('sem login: 401', async () => {
    current = null
    expect((await patch({ userId: 'vinny', enabled: true })).status).toBe(401)
  })
  it('admin da empresa (ou qualquer não super admin) NÃO consegue liberar nem para si mesmo: 403', async () => {
    for (const role of ['admin', 'employee', 'client', 'viewer']) {
      current = { id: 'vinny', role, isSuperAdmin: false, orgId: 'org-mawi' }
      expect((await patch({ userId: 'vinny', enabled: true })).status).toBe(403)
    }
    expect(updates).toHaveLength(0)
  })
  it('super admin libera um admin: grava só nele', async () => {
    const r = await patch({ userId: 'vinny', enabled: true })
    expect(r.status).toBe(200)
    expect(updates).toEqual([{ payload: { can_manage_branding: true }, id: 'vinny' }])
  })
  it('super admin também retira a liberação', async () => {
    await patch({ userId: 'vinny', enabled: false })
    expect(updates[0]!.payload).toEqual({ can_manage_branding: false })
  })
  it('corpo inválido: 400; usuário inexistente: 404', async () => {
    expect((await patch({ userId: 'vinny' })).status).toBe(400)
    expect((await patch({ userId: 5, enabled: true })).status).toBe(400)
    target = null
    expect((await patch({ userId: 'x', enabled: true })).status).toBe(404)
    expect(updates).toHaveLength(0)
  })
  it('só vale para ADMIN de uma empresa: técnico, cliente ou admin sem empresa são recusados', async () => {
    for (const t of [{ role: 'employee', org_id: 'o' }, { role: 'client', org_id: null }, { role: 'admin', org_id: null }, { role: 'super_admin', org_id: null }]) {
      target = { id: 't', email: 't@x', ...t }
      expect((await patch({ userId: 't', enabled: true })).status).toBe(400)
    }
    expect(updates).toHaveLength(0)
  })
})
