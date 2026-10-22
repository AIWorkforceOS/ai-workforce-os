import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'

async function load(actor: unknown, supabase: unknown) {
  vi.resetModules()
  vi.doMock('@/lib/app-user', () => ({ getAppUser: async () => actor }))
  vi.doMock('@/lib/supabase/service', () => ({ createServiceClient: () => supabase }))
  return import('../route')
}
const T1 = '11111111-1111-4111-8111-111111111111'
const T2 = '22222222-2222-4222-8222-222222222222'
const req = (b: unknown) => new Request('http://x', { method: 'PATCH', body: JSON.stringify(b) })
const admin = { id: 'adm', role: 'admin', isSuperAdmin: false, orgId: 'o1', jobRole: null }
const seed = () => createFakeSupabase({ users: [{ id: T1, role: 'admin', org_id: 'o1', job_role: null, is_active: true }, { id: T2, role: 'admin', org_id: 'o2', job_role: null, is_active: true }, { id: 'adm', role: 'admin', org_id: 'o1' }] })

describe('PATCH /api/admin/users/access', () => {
  beforeEach(() => vi.resetModules())

  it('401 sem sessão e 403 para função restrita ou visualização', async () => {
    expect((await (await load(null, seed().supabase)).PATCH(req({ userId: T1, access: 'financeiro' }))).status).toBe(401)
    expect((await (await load({ ...admin, jobRole: 'comercial' }, seed().supabase)).PATCH(req({ userId: T1, access: 'financeiro' }))).status).toBe(403)
    expect((await (await load({ ...admin, role: 'viewer' }, seed().supabase)).PATCH(req({ userId: T1, access: 'financeiro' }))).status).toBe(403)
  })

  it('administrador completo define a função de alguém da própria empresa', async () => {
    const f = seed()
    const res = await (await load(admin, f.supabase)).PATCH(req({ userId: T1, access: 'comercial' }))
    expect(res.status).toBe(200)
    expect(f.db.users![0]).toMatchObject({ role: 'admin', job_role: 'comercial' })
  })

  it('visualização zera a função; admin volta a completo; desativar funciona', async () => {
    const f = seed()
    await (await load(admin, f.supabase)).PATCH(req({ userId: T1, access: 'viewer' }))
    expect(f.db.users![0]).toMatchObject({ role: 'viewer', job_role: null })
    await (await load(admin, f.supabase)).PATCH(req({ userId: T1, access: 'admin', active: false }))
    expect(f.db.users![0]).toMatchObject({ role: 'admin', job_role: null, is_active: false })
  })

  it('bloqueia outra empresa, a si mesmo e valores inválidos', async () => {
    const f = seed()
    expect((await (await load(admin, f.supabase)).PATCH(req({ userId: T2, access: 'financeiro' }))).status).toBe(403)
    expect((await (await load({ ...admin, id: T1 }, f.supabase)).PATCH(req({ userId: T1, access: 'admin' }))).status).toBe(403)
    expect((await (await load(admin, f.supabase)).PATCH(req({ userId: T1, access: 'super_admin' }))).status).toBe(400)
    expect((await (await load(admin, f.supabase)).PATCH(req({ userId: T1 }))).status).toBe(400)
    expect(f.db.users![1]!.job_role).toBeNull()
  })
})
