import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getAppUser } from '@/lib/app-user'
import { fetchOrganizationVerticalKey } from '@/lib/organizations'
import { EducationManager } from '@/components/dashboard/education-manager'

export const dynamic = 'force-dynamic'

export default async function EducationPage({ searchParams }: { searchParams: Promise<{ unit?: string }> }) {
  const supabase = await createClient()
  const appUser = await getAppUser()
  if (!appUser?.orgId) redirect('/dashboard')

  const verticalKey = await fetchOrganizationVerticalKey(supabase, appUser.orgId)
  if (verticalKey !== 'vocational_education') redirect('/dashboard')

  const { data: units } = await supabase
    .from('units')
    .select('id,name')
    .eq('org_id', appUser.orgId)
    .eq('is_active', true)
    .order('name')

  const requestedUnit = (await searchParams).unit
  const allowedRequestedUnit = units?.some((unit) => unit.id === requestedUnit) ? requestedUnit : null
  const unitId = appUser.unitId ?? allowedRequestedUnit ?? units?.[0]?.id ?? null
  if (!unitId) {
    return <div className="p-8 text-slate-300">Cadastre uma unidade antes de configurar a escola.</div>
  }

  const tables = [
    'education_programs', 'education_subjects', 'education_teachers', 'education_students',
    'education_cohorts', 'education_enrollments', 'education_class_sessions',
    'education_attendance', 'education_documents', 'education_diplomas',
  ] as const
  const results = await Promise.all(tables.map((table) => supabase.from(table).select('*').eq('unit_id', unitId).order('created_at', { ascending: false })))
  const data = Object.fromEntries(tables.map((table, index) => [table, results[index]?.data ?? []]))

  return (
    <EducationManager
      orgId={appUser.orgId}
      initialUnitId={unitId}
      units={units ?? []}
      readOnly={appUser.role === 'viewer'}
      data={data}
    />
  )
}
