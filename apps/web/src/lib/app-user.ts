import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'

export type AppRole = 'super_admin' | 'admin' | 'viewer'

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
}

export const ROLE_LABEL: Record<AppRole, string> = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  viewer: 'Visualização',
}

type AppUserRow = {
  id: string
  email: string
  name: string | null
  role: string
  org_id: string | null
  unit_id: string | null
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
    .select('id, email, name, role, org_id, unit_id, is_active, organizations(name)')
    .ilike('email', user.email)
    .maybeSingle()

  const row = data as AppUserRow | null
  if (!row || !row.is_active) return null

  const role: AppRole = row.role === 'super_admin' || row.role === 'viewer' ? row.role : 'admin'

  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role,
    orgId: row.org_id,
    orgName: row.organizations?.name ?? null,
    isSuperAdmin: role === 'super_admin',
    unitId: row.unit_id,
  }
})
