import type { JobRole } from '@/lib/permissions/job-roles'

type Actor = { id: string; role: string; isSuperAdmin: boolean; jobRole: JobRole | null }

/** Lead criado por quem tem a função Comercial nasce atribuído a ele (o banco só deixa o Comercial criar leads dele). Para os demais, sem responsável. */
export function ownerForNewLead(actor: Pick<Actor, 'id' | 'jobRole'>): string | null {
  return actor.jobRole === 'comercial' ? actor.id : null
}

/** Quem atribui leads a outras pessoas: super admin ou administrador completo. O Comercial só trabalha os leads que recebeu. */
export function canAssignLeads(actor: Actor | null | undefined): boolean {
  if (!actor) return false
  return actor.isSuperAdmin || (actor.role === 'admin' && actor.jobRole === null)
}

/** "Excluir todos os leads" é perigoso: nunca para o Comercial. */
export function canDeleteAllLeads(actor: Pick<Actor, 'jobRole'>): boolean {
  return actor.jobRole !== 'comercial'
}

/** Destino válido para atribuir: usuário ativo de escritório da mesma empresa que pode trabalhar leads (admin completo ou Comercial). */
export function validAssignee(target: { role: string; org_id: string | null; is_active: boolean; job_role?: string | null } | null, orgId: string | null): boolean {
  if (!target || !target.is_active || target.role !== 'admin' || !orgId || target.org_id !== orgId) return false
  return !target.job_role || target.job_role === 'comercial'
}
