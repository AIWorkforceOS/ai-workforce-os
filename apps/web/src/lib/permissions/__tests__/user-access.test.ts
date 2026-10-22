import { describe, expect, it } from 'vitest'
import { canEditTargetAccess, canManageUserAccess } from '../user-access'

const actor = { id: 'a', role: 'admin', isSuperAdmin: false, orgId: 'o1', jobRole: null }

describe('canManageUserAccess', () => {
  it('só super admin ou administrador completo', () => {
    expect(canManageUserAccess(actor)).toBe(true)
    expect(canManageUserAccess({ ...actor, role: 'super_admin', isSuperAdmin: true, orgId: null })).toBe(true)
    expect(canManageUserAccess({ ...actor, jobRole: 'financeiro' })).toBe(false)
    expect(canManageUserAccess({ ...actor, role: 'viewer' })).toBe(false)
    expect(canManageUserAccess({ ...actor, role: 'employee' })).toBe(false)
    expect(canManageUserAccess({ ...actor, orgId: null })).toBe(false)
    expect(canManageUserAccess(null)).toBe(false)
  })
})

describe('canEditTargetAccess', () => {
  it('bloqueia a si mesmo, super admin, técnico/cliente e outra empresa', () => {
    expect(canEditTargetAccess(actor, { id: 'a', role: 'admin', orgId: 'o1' }).ok).toBe(false)
    expect(canEditTargetAccess(actor, { id: 'x', role: 'super_admin', orgId: 'o1' }).ok).toBe(false)
    expect(canEditTargetAccess(actor, { id: 'x', role: 'employee', orgId: 'o1' }).ok).toBe(false)
    expect(canEditTargetAccess(actor, { id: 'x', role: 'client', orgId: null }).ok).toBe(false)
    expect(canEditTargetAccess(actor, { id: 'x', role: 'admin', orgId: 'o2' }).ok).toBe(false)
  })
  it('permite admin/visualização da mesma empresa', () => {
    expect(canEditTargetAccess(actor, { id: 'x', role: 'admin', orgId: 'o1' }).ok).toBe(true)
    expect(canEditTargetAccess(actor, { id: 'x', role: 'viewer', orgId: 'o1' }).ok).toBe(true)
  })
  it('super admin edita qualquer empresa', () => {
    expect(canEditTargetAccess({ ...actor, isSuperAdmin: true, role: 'super_admin' }, { id: 'x', role: 'admin', orgId: 'o2' }).ok).toBe(true)
  })
})
