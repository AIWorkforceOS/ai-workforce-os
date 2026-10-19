import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'

/** Quem entra no painel do piloto: só admin da MESMA empresa (ou super admin). O restante recebe 404 e ninguém tem as permissões alteradas. */
const getAppUser = vi.fn()
const units = [{ id: 'u-mawi', org_id: 'org-mawi', name: 'Mawi Pro — Principal', quote_ai_team_mode: 'off' }, { id: 'u-mawi-2', org_id: 'org-mawi', name: 'Outra unidade Mawi', quote_ai_team_mode: 'off' }, { id: 'u-other', org_id: 'org-other', name: 'Outra empresa', quote_ai_team_mode: 'off' }]
vi.mock('@/lib/app-user', () => ({ getAppUser: () => getAppUser() }))
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => createFakeSupabase({ units: structuredClone(units) }).supabase }))

const user = (over: Record<string, unknown> = {}) => ({ id: 'usr', email: 'vinny29lp@gmail.com', name: 'Vinicius', role: 'admin', orgId: 'org-mawi', orgName: 'Mawi Pro', isSuperAdmin: false, unitId: null, employeeId: null, clientCompany: null, ...over })

describe('requireUnitAdmin', () => {
  beforeEach(() => getAppUser.mockReset())

  it('admin da organização Mawi Pro (conta vinny29lp@gmail.com) entra no painel da unidade Mawi Pro', async () => {
    getAppUser.mockResolvedValue(user())
    const { requireUnitAdmin } = await import('../admin-guard')
    const r = await requireUnitAdmin('u-mawi')
    expect(r.ok).toBe(true)
    expect(r.ok && r.ctx.unit).toMatchObject({ id: 'u-mawi', org_id: 'org-mawi', quote_ai_team_mode: 'off' })
  })
  it('não autenticado: 401', async () => {
    getAppUser.mockResolvedValue(null)
    const { requireUnitAdmin } = await import('../admin-guard')
    expect(await requireUnitAdmin('u-mawi')).toMatchObject({ ok: false, status: 401 })
  })
  it('admin de OUTRA empresa, funcionário e cliente do Portal 360: 404 (não revela que existe)', async () => {
    const { requireUnitAdmin } = await import('../admin-guard')
    for (const u of [user({ orgId: 'org-other' }), user({ role: 'employee', employeeId: 'e1' }), user({ role: 'client', orgId: null }), user({ role: 'viewer' })]) {
      getAppUser.mockResolvedValue(u)
      expect(await requireUnitAdmin('u-mawi')).toMatchObject({ ok: false, status: 404 })
    }
  })
  it('admin "dono de unidade" só alcança a própria unidade; super admin alcança qualquer uma', async () => {
    const { requireUnitAdmin } = await import('../admin-guard')
    getAppUser.mockResolvedValue(user({ unitId: 'u-mawi' }))
    expect((await requireUnitAdmin('u-mawi')).ok).toBe(true)
    expect(await requireUnitAdmin('u-mawi-2')).toMatchObject({ ok: false, status: 404 })
    getAppUser.mockResolvedValue(user({ role: 'super_admin', orgId: null, isSuperAdmin: true }))
    expect((await requireUnitAdmin('u-other')).ok).toBe(true)
  })
  it('unidade inexistente: 404', async () => {
    getAppUser.mockResolvedValue(user())
    const { requireUnitAdmin } = await import('../admin-guard')
    expect(await requireUnitAdmin('nao-existe')).toMatchObject({ ok: false, status: 404 })
  })
})
