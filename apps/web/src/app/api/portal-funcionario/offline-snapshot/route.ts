import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAppUser } from '@/lib/app-user'
import { fetchEmployeePortalData, fetchEmployeeUnitContext } from '@/lib/portal-funcionario/data'

/**
 * Agenda do técnico para uso offline (app instalado). Só devolve o que o servidor já deixa ESSE técnico
 * ver (mesma RLS e mesmos filtros do portal) — nunca dados de outro funcionário. Sem cache.
 */
export async function GET() {
  const appUser = await getAppUser()
  if (!appUser) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401, headers: { 'Cache-Control': 'no-store' } })
  if (appUser.role !== 'employee' || !appUser.employeeId) return NextResponse.json({ error: 'Somente para funcionários.' }, { status: 403, headers: { 'Cache-Control': 'no-store' } })

  const supabase = await createClient()
  const [{ appointments }, context] = await Promise.all([
    fetchEmployeePortalData(supabase, appUser.employeeId),
    fetchEmployeeUnitContext(supabase, appUser.employeeId),
  ])

  return NextResponse.json(
    {
      employeeId: appUser.employeeId,
      appointments,
      timezone: context.timezone,
      locale: context.locale,
      requiresCheckin: context.requiresCheckin,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
