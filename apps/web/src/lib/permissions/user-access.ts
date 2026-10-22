import type { JobRole } from './job-roles'

type Actor = { id: string; role: string; isSuperAdmin: boolean; orgId: string | null; jobRole: JobRole | null }
type Target = { id: string; role: string; orgId: string | null }

/** Quem gerencia usuários e funções: super admin, ou administrador COMPLETO (sem função restrita) da empresa. */
export function canManageUserAccess(actor: Actor | null | undefined): boolean {
  if (!actor) return false
  if (actor.isSuperAdmin) return true
  return actor.role === 'admin' && actor.jobRole === null && Boolean(actor.orgId)
}

/**
 * Pode alterar a função/ativação deste usuário? Mesma empresa, nunca a si mesmo (ninguém se promove nem se desativa), nunca super admin,
 * e só contas de escritório (admin/visualização): técnico e cliente têm telas próprias de acesso.
 */
export function canEditTargetAccess(actor: Actor, target: Target): { ok: true } | { ok: false; error: string } {
  if (target.id === actor.id) return { ok: false, error: 'Você não pode alterar o próprio acesso.' }
  if (target.role === 'super_admin') return { ok: false, error: 'Este usuário não pode ser alterado.' }
  if (target.role !== 'admin' && target.role !== 'viewer') return { ok: false, error: 'Este tipo de acesso (técnico ou cliente) é gerenciado em outra tela.' }
  if (!actor.isSuperAdmin && target.orgId !== actor.orgId) return { ok: false, error: 'Usuário de outra empresa.' }
  return { ok: true }
}
