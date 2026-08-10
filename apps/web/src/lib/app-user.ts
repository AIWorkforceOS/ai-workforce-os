import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'

export type AppRole = 'super_admin' | 'admin' | 'viewer' | 'employee' | 'client'

export type AppUser = {
  /** id em public.users (não é o id do Supabase Auth) */
  id: string
  email: string
  name: string | null
  role: AppRole
  orgId: string | null
  orgName: string | null
  isSuperAdmin: boolean
  /** Preenchido = "dono de unidade": só acessa a própria unidade (ver can_access_unit no banco). */
  unitId: string | null
  /** Preenchido = a conta é de um funcionário (role='employee'): só vê os próprios dados no Portal do Funcionário. */
  employeeId: string | null
  /** Preenchido = a conta é de um cliente externo (role='client', ex.: "360 Service Provider"): só vê os dados desse client_company no Portal 360 — ver lib/portal-360/data.ts (migration 061). NULL nas demais roles. */
  clientCompany: string | null
}

export const ROLE_LABEL: Record<AppRole, string> = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  viewer: 'Visualização',
  employee: 'Funcionário',
  client: 'Cliente',
}

type AppUserRow = {
  id: string
  email: string
  name: string | null
  role: string
  org_id: string | null
  unit_id: string | null
  employee_id: string | null
  client_company: string | null
  is_active: boolean
  organizations: { name: string } | null
}

/**
 * Resolve o usuário de negócio (public.users) a partir da sessão do
 * Supabase Auth, cruzando pelo e-mail. Retorna null se não houver
 * sessão ou se o e-mail não estiver provisionado em public.users.
 *
 * Cacheado por request (React cache) — pode ser chamado em layout e
 * páginas sem query duplicada.
 */
export const getAppUser = cache(async (): Promise<AppUser | null> => {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user?.email) return null

  const { data } = await supabase
    .from('users')
    .select('id, email, name, role, org_id, unit_id, employee_id, client_company, is_active, organizations(name)')
    .ilike('email', user.email)
    .maybeSingle()

  const row = data as AppUserRow | null
  if (!row || !row.is_active) return null

  const role: AppRole =
    row.role === 'super_admin' || row.role === 'viewer' || row.role === 'employee' || row.role === 'client'
      ? row.role
      : 'admin'

  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role,
    orgId: row.org_id,
    orgName: row.organizations?.name ?? null,
    isSuperAdmin: role === 'super_admin',
    unitId: row.unit_id,
    employeeId: row.employee_id,
    clientCompany: role === 'client' ? row.client_company : null,
  }
})
