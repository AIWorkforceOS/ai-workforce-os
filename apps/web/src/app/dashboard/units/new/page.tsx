import { createClient } from '@/lib/supabase/server'
import { getAppUser } from '@/lib/app-user'
import { NewUnitForm } from './new-unit-form'

export default async function NewUnitPage({
  searchParams,
}: {
  searchParams: Promise<{ org_id?: string }>
}) {
  const appUser = await getAppUser()
  const { org_id: orgIdParam } = await searchParams

  let organizations: { id: string; name: string }[] | null = null
  let defaultOrgId = ''

  if (appUser?.isSuperAdmin) {
    const supabase = await createClient()
    const { data } = await supabase.from('organizations').select('id, name').order('name')
    organizations = data ?? []
    defaultOrgId = orgIdParam && organizations.some((o) => o.id === orgIdParam) ? orgIdParam : ''
  } else {
    defaultOrgId = appUser?.orgId ?? ''
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-500">gestão</p>
        <h1 className="mt-0.5 text-2xl font-black tracking-tight text-white">Nova unidade</h1>
        <p className="mt-0.5 text-sm text-slate-400">Cadastre uma nova unidade.</p>
      </div>

      {!appUser?.isSuperAdmin && !defaultOrgId ? (
        <p className="max-w-xl text-sm text-red-400">
          Sua conta não está vinculada a nenhuma empresa — não é possível criar uma unidade. Fale com a equipe Alizo.
        </p>
      ) : (
        <NewUnitForm organizations={organizations} defaultOrgId={defaultOrgId} />
      )}
    </div>
  )
}
