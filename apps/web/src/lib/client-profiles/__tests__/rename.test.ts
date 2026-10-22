import { describe, expect, it } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'
import { renameClientEverywhere } from '../rename'

const seed = () =>
  createFakeSupabase({
    client_company_profiles: [{ id: 'p1', org_id: 'o1', name: 'ACME' }, { id: 'p2', org_id: 'o1', name: 'Beta' }, { id: 'p3', org_id: 'o2', name: 'ACME Brasil' }],
    customers: [
      { id: 'c1', org_id: 'o1', name: 'ACME', client_company: 'ACME' },
      { id: 'c2', org_id: 'o1', name: 'Loja 12', client_company: 'acme ' },
      { id: 'c3', org_id: 'o1', name: 'Loja Beta', client_company: 'Beta' },
      { id: 'c4', org_id: 'o2', name: 'ACME', client_company: 'ACME' }, // outra empresa: intocado
    ],
    users: [{ id: 'u1', role: 'client', client_company: 'ACME' }, { id: 'u2', role: 'client', client_company: 'Beta' }, { id: 'u3', role: 'admin', client_company: null }],
  })

describe('renameClientEverywhere', () => {
  it('renomeia perfil, cadastros por unidade e logins do portal — só deste cliente e desta empresa', async () => {
    const f = seed()
    const r = await renameClientEverywhere(f.supabase, { profileId: 'p1', orgId: 'o1', oldName: 'ACME', newName: '  ACME  Corp ' })
    expect(r).toEqual({ ok: true, changed: true, customers: 2, logins: 1 })
    expect(f.db.client_company_profiles![0]!.name).toBe('ACME Corp')
    expect(f.db.customers![0]).toMatchObject({ name: 'ACME Corp', client_company: 'ACME Corp' })
    expect(f.db.customers![1]).toMatchObject({ name: 'Loja 12', client_company: 'ACME Corp' }) // loja mantém o nome da loja
    expect(f.db.customers![2]!.client_company).toBe('Beta')
    expect(f.db.customers![3]!.client_company).toBe('ACME')
    expect(f.db.users![0]!.client_company).toBe('ACME Corp')
    expect(f.db.users![1]!.client_company).toBe('Beta')
  })
  it('nome repetido na mesma empresa é recusado e nada muda', async () => {
    const f = seed()
    expect(await renameClientEverywhere(f.supabase, { profileId: 'p1', orgId: 'o1', oldName: 'ACME', newName: 'beta' })).toMatchObject({ ok: false, status: 409 })
    expect(f.db.client_company_profiles![0]!.name).toBe('ACME')
    expect(f.db.customers![0]!.client_company).toBe('ACME')
  })
  it('mesmo nome (ou só espaços) não faz nada; vazio é recusado', async () => {
    const f = seed()
    expect(await renameClientEverywhere(f.supabase, { profileId: 'p1', orgId: 'o1', oldName: 'ACME', newName: ' ACME ' })).toMatchObject({ ok: true, changed: false })
    expect(await renameClientEverywhere(f.supabase, { profileId: 'p1', orgId: 'o1', oldName: 'ACME', newName: '   ' })).toMatchObject({ ok: false, status: 400 })
  })
  it('se atualizar as ordens falha, o nome do cadastro volta', async () => {
    const f = createFakeSupabase({ client_company_profiles: [{ id: 'p1', org_id: 'o1', name: 'ACME' }], customers: [{ id: 'c1', org_id: 'o1', name: 'ACME', client_company: 'ACME' }], users: [] }, { customers: { update: 'boom' } })
    expect(await renameClientEverywhere(f.supabase, { profileId: 'p1', orgId: 'o1', oldName: 'ACME', newName: 'Novo' })).toMatchObject({ ok: false, status: 500 })
    expect(f.db.client_company_profiles![0]!.name).toBe('ACME')
  })
})
