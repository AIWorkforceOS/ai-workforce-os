import { NextResponse } from 'next/server'
import { getAppUser, type AppUser } from '@/lib/app-user'

/** Cadastro do cliente: só administrador da empresa (ou super admin). A RLS do banco também exige isso. */
export async function requireClientProfileAdmin(): Promise<{ ok: true; appUser: AppUser } | { ok: false; response: NextResponse }> {
  const appUser = await getAppUser()
  if (!appUser) return { ok: false, response: NextResponse.json({ error: 'Não autenticado.' }, { status: 401 }) }
  if (appUser.role !== 'admin' && appUser.role !== 'super_admin') return { ok: false, response: NextResponse.json({ error: 'Somente administradores cadastram clientes.' }, { status: 403 }) }
  return { ok: true, appUser }
}
