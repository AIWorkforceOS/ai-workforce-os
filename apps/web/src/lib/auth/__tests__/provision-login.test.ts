import { describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'
import { generateInitialPassword, provisionLogin, resetLoginPassword, validatePassword } from '../provision-login'

type AuthStub = { createUser?: ReturnType<typeof vi.fn>; deleteUser?: ReturnType<typeof vi.fn>; generateLink?: ReturnType<typeof vi.fn>; updateUserById?: ReturnType<typeof vi.fn> }
function setup(seedUsers: Record<string, unknown>[] = [], auth: AuthStub = {}, errors = {}) {
  const fake = createFakeSupabase({ users: seedUsers }, errors)
  const admin = {
    createUser: auth.createUser ?? vi.fn(async () => ({ data: { user: { id: 'auth-1' } }, error: null })),
    deleteUser: auth.deleteUser ?? vi.fn(async () => ({ error: null })),
    generateLink: auth.generateLink ?? vi.fn(async () => ({ data: { user: { id: 'auth-9' }, properties: { action_link: 'https://x/link' } }, error: null })),
    updateUserById: auth.updateUserById ?? vi.fn(async () => ({ error: null })),
  }
  Object.assign(fake.supabase, { auth: { admin } })
  return { ...fake, admin }
}
const row = { name: 'Ana', role: 'client' as const, org_id: null, unit_id: null, client_company: 'ACME' }

describe('provisionLogin', () => {
  it('cria login com senha e o registro de negócio', async () => {
    const f = setup()
    const r = await provisionLogin(f.supabase, { email: ' Ana@ACME.com ', mode: { kind: 'password', password: 'Senha1234' }, row })
    expect(r).toMatchObject({ ok: true, setupLink: null })
    expect(f.admin.createUser).toHaveBeenCalledWith({ email: 'ana@acme.com', password: 'Senha1234', email_confirm: true })
    expect(f.db.users![0]).toMatchObject({ email: 'ana@acme.com', role: 'client', client_company: 'ACME', is_active: true })
  })
  it('nunca assume conta que já existe (qualquer papel/empresa)', async () => {
    const f = setup([{ id: 'u0', email: 'chefe@x.com', role: 'super_admin' }])
    const r = await provisionLogin(f.supabase, { email: 'CHEFE@x.com', mode: { kind: 'password', password: 'Senha1234' }, row })
    expect(r).toMatchObject({ ok: false, status: 409 })
    expect(f.admin.createUser).not.toHaveBeenCalled()
    expect(f.db.users![0]).toMatchObject({ role: 'super_admin' })
  })
  it('login já existente no Auth (sem registro de negócio): recusa e não troca a senha', async () => {
    const createUser = vi.fn(async () => ({ data: { user: null }, error: { message: 'User already registered' } }))
    const f = setup([], { createUser })
    const r = await provisionLogin(f.supabase, { email: 'a@b.com', mode: { kind: 'password', password: 'Senha1234' }, row })
    expect(r).toMatchObject({ ok: false, status: 409 })
    expect(f.admin.updateUserById).not.toHaveBeenCalled()
    expect(f.db.users).toHaveLength(0)
  })
  it('se o registro de negócio falha, apaga o login recém-criado', async () => {
    const f = setup([], {}, { users: { insert: 'boom' } })
    const r = await provisionLogin(f.supabase, { email: 'a@b.com', mode: { kind: 'password', password: 'Senha1234' }, row })
    expect(r).toMatchObject({ ok: false, status: 500 })
    expect(f.admin.deleteUser).toHaveBeenCalledWith('auth-1')
  })
  it('modo convite devolve o link e não cria senha', async () => {
    const f = setup()
    const r = await provisionLogin(f.supabase, { email: 'a@b.com', mode: { kind: 'invite', redirectTo: 'https://x/set' }, row })
    expect(r).toMatchObject({ ok: true, setupLink: 'https://x/link' })
    expect(f.admin.createUser).not.toHaveBeenCalled()
  })
  it('valida e-mail e senha', async () => {
    const f = setup()
    expect(await provisionLogin(f.supabase, { email: 'sem-arroba', mode: { kind: 'invite', redirectTo: 'x' }, row })).toMatchObject({ ok: false, status: 400 })
    expect(await provisionLogin(f.supabase, { email: 'a@b.com', mode: { kind: 'password', password: 'curta' }, row })).toMatchObject({ ok: false, status: 400 })
    expect(validatePassword('x'.repeat(73))).toMatch(/72/)
  })
})

describe('resetLoginPassword e generateInitialPassword', () => {
  it('redefine a senha da conta', async () => {
    const f = setup()
    expect(await resetLoginPassword(f.supabase, 'A@b.com', 'NovaSenha99')).toEqual({ ok: true })
    expect(f.admin.updateUserById).toHaveBeenCalledWith('auth-9', { password: 'NovaSenha99', email_confirm: true })
    expect(await resetLoginPassword(f.supabase, 'a@b.com', 'curta')).toMatchObject({ ok: false, status: 400 })
  })
  it('gera senha do tamanho pedido sem caracteres ambíguos', () => {
    const p = generateInitialPassword(14)
    expect(p).toHaveLength(14)
    expect(p).not.toMatch(/[0OIl1]/)
    expect(validatePassword(p)).toBeNull()
  })
})
