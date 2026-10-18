export type QuoteAccessUser = {
  role: string
  isSuperAdmin: boolean
  orgId: string | null
  unitId: string | null
  employeeId: string | null
}

export type QuoteAccess = 'admin' | 'technician' | 'none'

/**
 * Quem pode acompanhar/rodar um job de cotação (regra aplicada no servidor, em cima das regras de acesso do banco):
 *  - admin da MESMA empresa (e, se for "dono de unidade", da mesma unidade) ou super admin ⇒ 'admin' (vê custos de IA e modo sombra);
 *  - técnico responsável pela ordem ⇒ 'technician', mas SÓ em modo 'live' (em 'shadow' ninguém além do admin vê a análise);
 *  - qualquer outro (outro técnico, cliente do Portal 360, outra empresa) ⇒ 'none' (a rota responde 404, sem revelar que existe).
 */
export function resolveQuoteJobAccess(user: QuoteAccessUser, job: { org_id: string; unit_id: string; mode: 'shadow' | 'live' }, appointmentEmployeeId: string | null): QuoteAccess {
  if (user.isSuperAdmin) return 'admin'
  if (user.role === 'admin' && user.orgId === job.org_id && (!user.unitId || user.unitId === job.unit_id)) return 'admin'
  if (user.role === 'employee' && user.employeeId && user.employeeId === appointmentEmployeeId && user.orgId === job.org_id && job.mode === 'live') return 'technician'
  return 'none'
}
