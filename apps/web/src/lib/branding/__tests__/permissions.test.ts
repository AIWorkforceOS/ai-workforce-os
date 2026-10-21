import { describe, expect, it } from 'vitest'
import { canEditOrgBranding, canGrantBrandingAccess, canReceiveBrandingAccess, type BrandingActor } from '../permissions'

const actor = (over: Partial<BrandingActor> = {}): BrandingActor => ({ role: 'admin', orgId: 'org-A', isSuperAdmin: false, canManageBranding: false, ...over })

describe('quem pode trocar a logo', () => {
  it('admin SEM a liberação do super admin: não pode, nem da própria empresa', () => {
    expect(canEditOrgBranding(actor(), 'org-A')).toBe(false)
  })
  it('admin COM a liberação: só da própria empresa', () => {
    expect(canEditOrgBranding(actor({ canManageBranding: true }), 'org-A')).toBe(true)
    expect(canEditOrgBranding(actor({ canManageBranding: true }), 'org-B')).toBe(false)
  })
  it('super admin: de qualquer empresa', () => {
    expect(canEditOrgBranding(actor({ role: 'super_admin', isSuperAdmin: true, orgId: null }), 'org-B')).toBe(true)
  })
  it('técnico, cliente e visualização nunca, mesmo com a flag ligada por engano', () => {
    for (const role of ['employee', 'client', 'viewer'] as const) expect(canEditOrgBranding(actor({ role, canManageBranding: true }), 'org-A')).toBe(false)
  })
  it('sem empresa alvo: nunca', () => {
    expect(canEditOrgBranding(actor({ canManageBranding: true }), null)).toBe(false)
  })
  it('só o super admin concede; só para admin de uma empresa', () => {
    expect(canGrantBrandingAccess({ isSuperAdmin: true })).toBe(true)
    expect(canGrantBrandingAccess({ isSuperAdmin: false })).toBe(false)
    expect(canReceiveBrandingAccess({ role: 'admin', orgId: 'org-A' })).toBe(true)
    for (const role of ['employee', 'client', 'viewer', 'super_admin']) expect(canReceiveBrandingAccess({ role, orgId: 'org-A' })).toBe(false)
    expect(canReceiveBrandingAccess({ role: 'admin', orgId: null })).toBe(false)
  })
})
