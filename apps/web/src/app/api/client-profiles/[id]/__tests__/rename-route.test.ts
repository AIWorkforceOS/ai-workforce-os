import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'

const ID = '11111111-1111-4111-8111-111111111111'
const world = () =>
  createFakeSupabase({
    client_company_profiles: [{ id: ID, org_id: 'o1', name: 'ACME', phone: '1' }, { id: 'p2', org_id: 'o1', name: 'Beta' }],
    customers: [{ id: 'c1', org_id: 'o1', name: 'ACME', client_company: 'ACME' }],
    users: [{ id: 'u1', role: 'client', client_company: 'ACME' }],
  })
async function load(actor: unknown, w: ReturnType<typeof world>) {
  vi.resetModules()
  vi.doMock('@/lib/app-user', () => ({ getAppUser: async () => actor }))
  vi.doMock('@/lib/supabase/server', () => ({ createClient: async () => w.supabase }))
  vi.doMock('@/lib/supabase/service', () => ({ createServiceClient: () => w.supabase }))
  return import('../route')
}
const admin = { id: 'a', role: 'admin', orgId: 'o1' }
const patch = (mod: { PATCH: (r: Request, c: { params: Promise<{ id: string }> }) => Promise<Response> }, body: unknown) => mod.PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify(body) }), { params: Promise.resolve({ id: ID }) })

describe('PATCH /api/client-profiles/[id] — renomear', () => {
  beforeEach(() => vi.resetModules())
  it('renomeia o cliente e leva junto o cadastro por unidade e o login do portal', async () => {
    const w = world()
    const res = await patch(await load(admin, w), { name: 'ACME Corp', phone: '555' })
    expect(res.status).toBe(200)
    expect(w.db.client_company_profiles![0]).toMatchObject({ name: 'ACME Corp', phone: '555' })
    expect(w.db.customers![0]).toMatchObject({ name: 'ACME Corp', client_company: 'ACME Corp' })
    expect(w.db.users![0]!.client_company).toBe('ACME Corp')
  })
  it('só o nome também funciona; nome repetido dá 409 e nada muda', async () => {
    const w = world()
    const mod = await load(admin, w)
    expect((await patch(mod, { name: 'Beta' })).status).toBe(409)
    expect(w.db.client_company_profiles![0]!.name).toBe('ACME')
    expect((await patch(mod, { name: 'Novo' })).status).toBe(200)
  })
  it('técnico não renomeia', async () => {
    const w = world()
    expect((await patch(await load({ id: 'e', role: 'employee', orgId: 'o1' }, w), { name: 'X' })).status).toBe(403)
    expect(w.db.client_company_profiles![0]!.name).toBe('ACME')
  })
})
