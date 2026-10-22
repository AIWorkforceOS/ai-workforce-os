import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'

function service(seed: Record<string, Record<string, unknown>[]> = {}, errors = {}) {
  const fake = createFakeSupabase({ units: [{ id: '11111111-1111-4111-8111-111111111111', org_id: 'o1' }], employees: [], users: [], ...seed }, errors)
  const admin = {
    createUser: vi.fn(async () => ({ data: { user: { id: 'auth-1' } }, error: null })),
    deleteUser: vi.fn(async () => ({ error: null })),
    generateLink: vi.fn(async () => ({ data: { properties: { action_link: 'https://x/link' } }, error: null })),
  }
  Object.assign(fake.supabase, { auth: { admin } })
  return { ...fake, admin }
}
async function load(actor: unknown, svc: unknown) {
  vi.resetModules()
  vi.doMock('@/lib/app-user', () => ({ getAppUser: async () => actor }))
  vi.doMock('@/lib/supabase/service', () => ({ createServiceClient: () => svc }))
  return import('../route')
}
const req = (b: unknown) => new Request('http://x', { method: 'POST', body: JSON.stringify(b) })
const admin = { id: 'adm', role: 'admin', isSuperAdmin: false, orgId: 'o1', unitId: null, jobRole: null }
const pwd = { kind: 'password', password: 'Senha1234' }

describe('POST /api/admin/team/members', () => {
  beforeEach(() => vi.resetModules())

  it('técnico: cria cadastro do funcionário + login do Portal do Funcionário (role employee) com a unidade da empresa', async () => {
    const f = service()
    const res = await (await load(admin, f.supabase)).POST(req({ name: 'João', email: 'Joao@Mawi.com', access: 'technician', login: pwd, specialty: 'Elétrica', defaultPay: 50 }))
    expect(res.status).toBe(200)
    expect(f.db.employees![0]).toMatchObject({ name: 'João', role: 'technician', org_id: 'o1', unit_id: '11111111-1111-4111-8111-111111111111', default_pay: 50 })
    expect(f.db.users![0]).toMatchObject({ email: 'joao@mawi.com', role: 'employee', employee_id: f.db.employees![0]!.id, org_id: 'o1' })
    expect(f.db.users![0]).not.toHaveProperty('job_role')
  })

  it('escritório: cada função vira o papel certo e NADA de técnico é criado', async () => {
    const f = service()
    for (const [email, access] of [['a@m.com', 'financeiro'], ['b@m.com', 'comercial'], ['c@m.com', 'operacional'], ['d@m.com', 'admin'], ['e@m.com', 'viewer']] as const) {
      expect((await (await load(admin, f.supabase)).POST(req({ name: 'X', email, access, login: pwd }))).status).toBe(200)
    }
    const by = (e: string) => f.db.users!.find((u) => u.email === e)!
    expect(by('a@m.com')).toMatchObject({ role: 'admin', job_role: 'financeiro' })
    expect(by('b@m.com')).toMatchObject({ role: 'admin', job_role: 'comercial' })
    expect(by('c@m.com')).toMatchObject({ role: 'admin', job_role: 'operacional' })
    expect(by('d@m.com')).toMatchObject({ role: 'admin' })
    expect(by('d@m.com').job_role ?? null).toBeNull()
    expect(by('e@m.com')).toMatchObject({ role: 'viewer' })
    expect(f.db.employees).toHaveLength(0)
  })

  it('convite devolve o link e não define senha', async () => {
    const f = service()
    const res = await (await load(admin, f.supabase)).POST(req({ name: 'X', email: 'a@m.com', access: 'comercial', login: { kind: 'invite' } }))
    expect((await res.json()).setupLink).toBe('https://x/link')
    expect(f.admin.createUser).not.toHaveBeenCalled()
  })

  it('e-mail já em uso: 409, nada criado e o cadastro do técnico é desfeito', async () => {
    const f = service({ users: [{ id: 'u0', email: 'joao@mawi.com', role: 'super_admin' }] })
    const res = await (await load(admin, f.supabase)).POST(req({ name: 'João', email: 'joao@mawi.com', access: 'technician', login: pwd }))
    expect(res.status).toBe(409)
    expect(f.db.employees).toHaveLength(0)
    expect(f.db.users).toHaveLength(1)
  })

  it('só administrador completo; função restrita e outras empresas são negadas; senha curta recusada', async () => {
    const f = service()
    expect((await (await load(null, f.supabase)).POST(req({ name: 'X', email: 'a@m.com', access: 'viewer', login: pwd }))).status).toBe(401)
    expect((await (await load({ ...admin, jobRole: 'financeiro' }, f.supabase)).POST(req({ name: 'X', email: 'a@m.com', access: 'viewer', login: pwd }))).status).toBe(403)
    expect((await (await load(admin, f.supabase)).POST(req({ name: 'X', email: 'a@m.com', access: 'viewer', login: { kind: 'password', password: 'curta' } }))).status).toBe(400)
    expect((await (await load(admin, f.supabase)).POST(req({ name: 'X', email: 'a@m.com', access: 'viewer', login: pwd, unitId: '22222222-2222-4222-8222-222222222222' }))).status).toBe(404)
    expect(f.db.users).toHaveLength(0)
  })

  it('ninguém se cria como super_admin', async () => {
    const f = service()
    expect((await (await load(admin, f.supabase)).POST(req({ name: 'X', email: 'a@m.com', access: 'super_admin', login: pwd }))).status).toBe(400)
  })
})
