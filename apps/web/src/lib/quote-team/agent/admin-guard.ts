import type { SupabaseClient } from '@supabase/supabase-js'
import { getAppUser, type AppUser } from '@/lib/app-user'
import { createServiceClient } from '@/lib/supabase/service'

export type UnitAdmin = { appUser: AppUser; db: SupabaseClient; unit: { id: string; org_id: string; name: string; quote_ai_team_mode: string } }

/** Só administrador da MESMA empresa (ou super admin) mexe no painel do piloto: o restante recebe 404 (não revela que existe). */
export async function requireUnitAdmin(unitId: string): Promise<{ ok: true; ctx: UnitAdmin } | { ok: false; status: number; error: string }> {
  const appUser = await getAppUser()
  if (!appUser) return { ok: false, status: 401, error: 'Não autenticado.' }
  const db = createServiceClient()
  if (!db) return { ok: false, status: 503, error: 'Serviço indisponível.' }
  const { data } = await db.from('units').select('id, org_id, name, quote_ai_team_mode').eq('id', unitId).maybeSingle()
  const unit = data as { id: string; org_id: string | null; name: string; quote_ai_team_mode?: string | null } | null
  if (!unit?.org_id) return { ok: false, status: 404, error: 'Não encontrado.' }
  const isAdmin = appUser.isSuperAdmin || (appUser.role === 'admin' && appUser.orgId === unit.org_id && (!appUser.unitId || appUser.unitId === unit.id))
  if (!isAdmin) return { ok: false, status: 404, error: 'Não encontrado.' }
  return { ok: true, ctx: { appUser, db, unit: { id: unit.id, org_id: unit.org_id, name: unit.name, quote_ai_team_mode: unit.quote_ai_team_mode ?? 'off' } } }
}
