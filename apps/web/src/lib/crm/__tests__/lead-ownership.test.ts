import { describe, expect, it } from 'vitest'
import { canAssignLeads, canDeleteAllLeads, ownerForNewLead, validAssignee } from '../lead-ownership'

const admin = { id: 'a', role: 'admin', isSuperAdmin: false, jobRole: null }
describe('lead ownership', () => {
  it('Comercial cria lead em nome dele; os demais, sem responsável', () => {
    expect(ownerForNewLead({ id: 'c1', jobRole: 'comercial' })).toBe('c1')
    expect(ownerForNewLead({ id: 'a', jobRole: null })).toBeNull()
    expect(ownerForNewLead({ id: 'f', jobRole: 'financeiro' })).toBeNull()
  })
  it('só admin completo ou super admin atribui leads', () => {
    expect(canAssignLeads(admin)).toBe(true)
    expect(canAssignLeads({ ...admin, role: 'super_admin', isSuperAdmin: true })).toBe(true)
    expect(canAssignLeads({ ...admin, jobRole: 'comercial' })).toBe(false)
    expect(canAssignLeads({ ...admin, role: 'viewer' })).toBe(false)
    expect(canAssignLeads(null)).toBe(false)
  })
  it('Comercial nunca exclui todos', () => {
    expect(canDeleteAllLeads({ jobRole: 'comercial' })).toBe(false)
    expect(canDeleteAllLeads({ jobRole: null })).toBe(true)
  })
  it('destino da atribuição: ativo, mesma empresa, admin completo ou Comercial', () => {
    const ok = { role: 'admin', org_id: 'o1', is_active: true, job_role: null }
    expect(validAssignee(ok, 'o1')).toBe(true)
    expect(validAssignee({ ...ok, job_role: 'comercial' }, 'o1')).toBe(true)
    expect(validAssignee({ ...ok, job_role: 'financeiro' }, 'o1')).toBe(false)
    expect(validAssignee({ ...ok, is_active: false }, 'o1')).toBe(false)
    expect(validAssignee({ ...ok, org_id: 'o2' }, 'o1')).toBe(false)
    expect(validAssignee({ ...ok, role: 'employee' }, 'o1')).toBe(false)
    expect(validAssignee(null, 'o1')).toBe(false)
  })
})
