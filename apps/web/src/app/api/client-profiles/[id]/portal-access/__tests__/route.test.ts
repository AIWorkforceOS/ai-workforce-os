import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'

const ID = '11111111-1111-4111-8111-111111111111'
const U1 = '22222222-2222-4222-8222-222222222222'
function world() {
  const user = createFakeSupabase({ client_company_profiles: [{ id: ID, org_id: 'o1', name: 'ACME' }] }) // o que a RLS devolve ao admin da empresa
  const svc = createFakeSupabase({
    users: [
      { id: U1, email: 'ana@acme.com', name: 'Ana', role: 'client', client_company: 'ACME', is_active: true },
      { id: 'u9', email: 'x@beta.com', name: 'X', role: 'client', client_company: 'Beta', is_active: true },
      { id: 'u8', email: 'boss@alizo.com', role: 'super_admin', client_company: null, is_active: true },
    ],
  })
  const admin = {
    createUser: vi.fn(async () => ({ data: { user: { id: 'auth-1' } }, error: null })),
    deleteUser: vi.fn(async () => ({ error: null })),
    generateLink: vi.fn(async () => ({ data: { user: { id: 'auth-9' }, properties: { action_link: 'https://x/link' } }, error: null })),
    updateUserById: vi.fn(async () => ({ error: null })),
  }
  Object.assign(svc.supabase, { auth: { admin } })
  return { user, svc, admin }
}
async function load(appUser: unknown, w: ReturnType<typeof world>) {
  vi.resetModules()
  vi.doMock('@/lib/app-user', () => ({ getAppUser: async () => appUser }))
  vi.doMock('@/lib/supabase/server', () => ({ createClient: async () => w.user.supabase }))
  vi.doMock('@/lib/supabase/service', () => ({ createServiceClient: () => w.svc.supabase }))
  return import('../route')
}
const adminUser = { id: 'adm', role: 'admin', orgId: 'o1' }
const params = { params: Promise.resolve({ id: ID }) }
const post = (b: unknown) => new Request('http://x', { method: 'POST', body: JSON.stringify(b) })
const patch = (b: unknown) => new Request('http://x', { method: 'PATCH', body: JSON.stringify(b) })

describe('portal-access do cliente', () => {
  beforeEach(() => vi.resetModules())

  it('lista só os logins deste cliente', async () => {
    const w = world()
    const res = await (await load(adminUser, w)).GET(new Request('http://x'), params)
    expect((await res.json()).logins.map((l: { email: string }) => l.email)).toEqual(['ana@acme.com'])
  })

  it('cria login do cliente com senha: role client, sem empresa, vinculado ao nome do cliente', async () => {
    const w = world()
    const res = await (await load(adminUser, w)).POST(post({ email: 'Novo@Acme.com', name: 'Novo', login: { kind: 'password', password: 'Senha1234' } }), params)
    expect(res.status).toBe(201)
    expect(w.svc.db.users!.at(-1)).toMatchObject({ email: 'novo@acme.com', role: 'client', client_company: 'ACME', org_id: null, unit_id: null })
    expect(w.admin.createUser).toHaveBeenCalledWith({ email: 'novo@acme.com', password: 'Senha1234', email_confirm: true })
  })

  it('e-mail que já é de outra conta (inclusive super admin) é recusado sem alterar nada', async () => {
    const w = world()
    const res = await (await load(adminUser, w)).POST(post({ email: 'boss@alizo.com', login: { kind: 'password', password: 'Senha1234' } }), params)
    expect(res.status).toBe(409)
    expect(w.admin.createUser).not.toHaveBeenCalled()
    expect(w.svc.db.users!.find((u) => u.id === 'u8')).toMatchObject({ role: 'super_admin' })
  })

  it('só administrador; cliente de outra empresa dá 404', async () => {
    const w = world()
    expect((await (await load({ id: 'e', role: 'employee', orgId: 'o1' }, w)).POST(post({ email: 'a@b.com', login: { kind: 'invite' } }), params)).status).toBe(403)
    const other = world()
    other.user.db.client_company_profiles!.length = 0 // a RLS não devolve cliente de outra empresa
    expect((await (await load(adminUser, other)).POST(post({ email: 'a@b.com', login: { kind: 'invite' } }), params)).status).toBe(404)
  })

  it('redefine senha, desativa e reativa — e não mexe em login de outro cliente', async () => {
    const w = world()
    const mod = await load(adminUser, w)
    expect((await mod.PATCH(patch({ userId: U1, newPassword: 'OutraSenha77' }), params)).status).toBe(200)
    expect(w.admin.updateUserById).toHaveBeenCalledWith('auth-9', { password: 'OutraSenha77', email_confirm: true })
    expect((await mod.PATCH(patch({ userId: U1, active: false }), params)).status).toBe(200)
    expect(w.svc.db.users![0]!.is_active).toBe(false)
    const other = '33333333-3333-4333-8333-333333333333'
    w.svc.db.users!.push({ id: other, email: 'z@beta.com', role: 'client', client_company: 'Beta', is_active: true })
    expect((await mod.PATCH(patch({ userId: other, active: false }), params)).status).toBe(404)
  })
})
