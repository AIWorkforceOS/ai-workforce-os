import type { AppRole } from '@/lib/app-user'

/**
 * Quem pode trocar a logo da empresa.
 *  - super admin Alizo: de qualquer empresa e concede/retira a permissão;
 *  - admin da empresa: SOMENTE se o super admin liberou (can_manage_branding) e SOMENTE da própria empresa;
 *  - técnico, cliente, visualização: nunca.
 */
export type BrandingActor = { role: AppRole; orgId: string | null; isSuperAdmin: boolean; canManageBranding: boolean }

export function canEditOrgBranding(actor: BrandingActor, targetOrgId: string | null | undefined): boolean {
  if (!targetOrgId) return false
  if (actor.isSuperAdmin) return true
  return actor.role === 'admin' && actor.canManageBranding && actor.orgId === targetOrgId
}

export function canGrantBrandingAccess(actor: Pick<BrandingActor, 'isSuperAdmin'>): boolean {
  return actor.isSuperAdmin
}

/** A permissão só faz sentido para um ADMIN que pertence a uma empresa. */
export function canReceiveBrandingAccess(target: { role: string; orgId: string | null }): boolean {
  return target.role === 'admin' && Boolean(target.orgId)
}
