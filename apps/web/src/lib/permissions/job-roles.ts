/**
 * Funções de acesso do escritório (camada acima do papel do banco). O papel do banco (users.role) continua sendo admin/viewer/employee/client;
 * a função (users.job_role, migration 104) só RESTRINGE um usuário 'admin': NULL = administrador completo (como todos os atuais).
 * Técnico = papel 'employee' (Portal do Funcionário); Cliente = papel 'client' (Portal 360) — ambos já existem e não passam por aqui.
 */
export const JOB_ROLES = ['financeiro', 'comercial', 'operacional'] as const
export type JobRole = (typeof JOB_ROLES)[number]

export const JOB_ROLE_LABEL: Record<JobRole, string> = {
  financeiro: 'Financeiro',
  comercial: 'Comercial',
  operacional: 'Operacional',
}

export const JOB_ROLE_DESCRIPTION: Record<JobRole, string> = {
  financeiro: 'Faturamento, invoices e financeiro; vê agenda e clientes. Não vê vendas, equipe nem configurações.',
  comercial: 'Funil de vendas, contatos, conversas, funcionários digitais e clientes; vê a agenda. Não vê financeiro.',
  operacional: 'Agenda, ordens, clientes, cotações e equipe (pessoas). Não vê financeiro nem vendas.',
}

export type AppModule = 'home' | 'agenda' | 'clientes' | 'financeiro' | 'crm' | 'agentes' | 'equipe' | 'config'

const ACCESS: Record<JobRole, readonly AppModule[]> = {
  financeiro: ['home', 'agenda', 'clientes', 'financeiro'],
  comercial: ['home', 'agenda', 'clientes', 'crm', 'agentes'],
  operacional: ['home', 'agenda', 'clientes', 'equipe'],
}

export function parseJobRole(value: unknown): JobRole | null {
  return typeof value === 'string' && (JOB_ROLES as readonly string[]).includes(value) ? (value as JobRole) : null
}

/** Pode usar o módulo? Sem função (NULL) = acesso completo. Só vale para quem é 'admin' no banco. */
export function canAccessModule(jobRole: JobRole | null | undefined, module: AppModule): boolean {
  if (!jobRole) return true
  return ACCESS[jobRole].includes(module)
}

/** Módulo de uma página do dashboard. O que não é reconhecido cai em 'config' (negado por padrão para funções restritas). */
export function moduleForPath(pathname: string): AppModule {
  const path = pathname.replace(/\/+$/, '') || '/'
  if (path === '/dashboard' || path === '/dashboard/sem-acesso' || path.startsWith('/dashboard/onboarding') || path.startsWith('/dashboard/results')) return 'home'

  const unit = path.match(/^\/dashboard\/units\/[^/]+(?:\/(.*))?$/)
  if (unit) {
    const sub = unit[1] ?? ''
    if (sub.startsWith('agenda') || sub.startsWith('relatorios')) return 'agenda'
    if (sub.startsWith('clientes')) return 'clientes'
    if (sub.startsWith('operacao') || sub.startsWith('faturamento')) return 'financeiro'
    return 'config'
  }

  if (path.startsWith('/dashboard/receptionist/customers') || path.startsWith('/dashboard/clientes-facility')) return 'clientes'
  if (path.startsWith('/dashboard/agenda')) return 'agenda'
  if (path.startsWith('/dashboard/operacao') || path.startsWith('/dashboard/faturamento') || path.startsWith('/dashboard/financial')) return 'financeiro'
  if (path.startsWith('/dashboard/crm') || path.startsWith('/dashboard/leads') || path.startsWith('/dashboard/conversations')) return 'crm'
  for (const p of ['agents', 'recruiter', 'receptionist', 'content', 'traffic', 'seo', 'email-marketing']) {
    if (path === `/dashboard/${p}` || path.startsWith(`/dashboard/${p}/`)) return 'agentes'
  }
  if (path.startsWith('/dashboard/employees')) return 'equipe'
  return 'config'
}

/** Caminho que depende da função do usuário (algum módulo é negado a alguma função)? Se não, o middleware nem consulta o banco. */
export function pathNeedsJobRoleCheck(pathname: string): boolean {
  return JOB_ROLES.some((r) => !canAccessModule(r, moduleForPath(pathname)))
}

/** Funções que um administrador pode atribuir ao criar/editar um usuário. */
export function assignableJobRole(value: unknown): JobRole | null | undefined {
  if (value === undefined || value === null || value === '' || value === 'admin') return null
  const parsed = parseJobRole(value)
  return parsed ?? undefined // undefined = valor inválido
}
