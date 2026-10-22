import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'

async function load(actor: unknown, service: unknown) {
  vi.resetModules()
  vi.doMock('@/lib/app-user', () => ({ getAppUser: async () => actor }))
  vi.doMock('@/lib/supabase/service', () => ({ createServiceClient: () => service }))
  vi.doMock('@/lib/auth/access-link', () => ({ generateAccessLink: async () => ({ ok: true, link: 'https://x/set', linkType: 'invite' }) }))
  vi.doMock('@/lib/email', () => ({ sendWelcomeEmail: async () => ({ ok: true }) }))
  return import('../route')
}
const req = (b: unknown) => new Request('http://x', { method: 'POST', body: JSON.stringify(b) })
const admin = { id: 'adm', role: 'admin', isSuperAdmin: false, orgId: 'o1', unitId: null, jobRole: null }
const seed = () => createFakeSupabase({ organizations: [{ id: 'o1', name: 'Mawi' }], users: [] })

describe('POST /api/admin/users (funções)', () => {
  beforeEach(() => vi.resetModules())

  it('administrador completo cria usuário com função restrita', async () => {
    const f = seed()
    const res = await (await load(admin, f.supabase)).POST(req({ email: 'Fin@Mawi.com', org_id: 'o1', job_role: 'financeiro' }))
    expect(res.status).toBe(200)
    expect(f.db.users![0]).toMatchObject({ email: 'fin@mawi.com', role: 'admin', job_role: 'financeiro', org_id: 'o1' })
  })

  it('cria conta de visualização (role viewer, sem função)', async () => {
    const f = seed()
    await (await load(admin, f.supabase)).POST(req({ email: 'v@mawi.com', org_id: 'o1', role: 'viewer', job_role: 'admin' }))
    expect(f.db.users![0]).toMatchObject({ role: 'viewer' })
    expect(f.db.users![0]).not.toHaveProperty('job_role')
  })

  it('nunca cria super_admin e rejeita função inválida', async () => {
    const f = seed()
    expect((await (await load(admin, f.supabase)).POST(req({ email: 'a@mawi.com', org_id: 'o1', job_role: 'dono' }))).status).toBe(400)
    await (await load(admin, f.supabase)).POST(req({ email: 'b@mawi.com', org_id: 'o1', role: 'super_admin' }))
    expect(f.db.users![0]).toMatchObject({ role: 'admin' })
  })

  it('função restrita não cria usuários; outra empresa é negada', async () => {
    const f = seed()
    expect((await (await load({ ...admin, jobRole: 'comercial' }, f.supabase)).POST(req({ email: 'c@mawi.com', org_id: 'o1' }))).status).toBe(403)
    expect((await (await load(admin, f.supabase)).POST(req({ email: 'd@x.com', org_id: 'o2' }))).status).toBe(403)
    expect(f.db.users).toHaveLength(0)
  })
})
