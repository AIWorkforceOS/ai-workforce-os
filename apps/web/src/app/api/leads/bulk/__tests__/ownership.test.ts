import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'

const world = () =>
  createFakeSupabase({
    units: [{ id: 'un1', org_id: 'o1' }],
    users: [
      { id: 'c1', role: 'admin', org_id: 'o1', is_active: true, job_role: 'comercial' },
      { id: 'f1', role: 'admin', org_id: 'o1', is_active: true, job_role: 'financeiro' },
      { id: 'x1', role: 'admin', org_id: 'o2', is_active: true, job_role: null },
    ],
    leads: [{ id: 'l1', unit_id: 'un1', owner_user_id: null }, { id: 'l2', unit_id: 'un1', owner_user_id: null }],
  })

async function load(actor: unknown, w: ReturnType<typeof world>) {
  vi.resetModules()
  vi.doMock('@/lib/app-user', () => ({ getAppUser: async () => actor }))
  vi.doMock('@/lib/supabase/server', () => ({ createClient: async () => w.supabase }))
  vi.doMock('@/lib/leads/lead-intake', () => ({ triggerFirstContact: async () => false }))
  vi.doMock('@/lib/sales/smarter-crm', () => ({ syncLeadToSmarterCrm: async () => undefined }))
  return import('../route')
}
const admin = { id: 'a1', role: 'admin', isSuperAdmin: false, orgId: 'o1', jobRole: null }
const comercial = { ...admin, id: 'c1', jobRole: 'comercial' }
const req = (method: string, body: unknown) => new Request('http://x', { method, body: JSON.stringify(body) })

describe('/api/leads/bulk — dono dos leads', () => {
  beforeEach(() => vi.resetModules())

  it('PATCH: administrador atribui vários leads a um Comercial', async () => {
    const w = world()
    const res = await (await load(admin, w)).PATCH(req('PATCH', { lead_ids: ['l1', 'l2'], owner_user_id: 'c1' }))
    expect(res.status).toBe(200)
    expect(w.db.leads!.map((l) => l.owner_user_id)).toEqual(['c1', 'c1'])
  })
  it('PATCH: null tira o responsável', async () => {
    const w = world()
    w.db.leads![0]!.owner_user_id = 'c1'
    await (await load(admin, w)).PATCH(req('PATCH', { lead_ids: ['l1'], owner_user_id: null }))
    expect(w.db.leads![0]!.owner_user_id).toBeNull()
  })
  it('PATCH: destino inválido (financeiro, outra empresa) é recusado e nada muda', async () => {
    const w = world()
    const mod = await load(admin, w)
    expect((await mod.PATCH(req('PATCH', { lead_ids: ['l1'], owner_user_id: 'f1' }))).status).toBe(400)
    expect((await mod.PATCH(req('PATCH', { lead_ids: ['l1'], owner_user_id: 'x1' }))).status).toBe(400)
    expect(w.db.leads!.every((l) => l.owner_user_id === null)).toBe(true)
  })
  it('PATCH: o Comercial não atribui (403); sem lista dá 400', async () => {
    const w = world()
    expect((await (await load(comercial, w)).PATCH(req('PATCH', { lead_ids: ['l1'], owner_user_id: 'c1' }))).status).toBe(403)
    expect((await (await load(admin, w)).PATCH(req('PATCH', { lead_ids: [], owner_user_id: 'c1' }))).status).toBe(400)
  })
  it('POST: leads importados pelo Comercial nascem dele; pelo administrador, sem responsável', async () => {
    const w = world()
    await (await load(comercial, w)).POST(req('POST', { unit_id: 'un1', leads: [{ company_name: 'Alfa' }] }))
    await (await load(admin, w)).POST(req('POST', { unit_id: 'un1', leads: [{ company_name: 'Beta' }] }))
    const by = (n: string) => w.db.leads!.find((l) => l.company_name === n)!
    expect(by('Alfa').owner_user_id).toBe('c1')
    expect(by('Beta').owner_user_id ?? null).toBeNull()
  })
  it('DELETE: o Comercial não exclui todos os leads', async () => {
    const w = world()
    const res = await (await load(comercial, w)).DELETE(req('DELETE', { unit_id: 'un1', delete_all: true }))
    expect(res.status).toBe(403)
    expect(w.db.leads).toHaveLength(2)
  })
})
