import { redirect } from 'next/navigation'
import { getAppUser } from '@/lib/app-user'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui/dashboard-ui'
import { ClientProfilesManager } from '@/components/clients/client-profiles-manager'
import { CLIENT_PROFILE_COLUMNS, type ClientProfile } from '@/lib/client-profiles/profile'

export const dynamic = 'force-dynamic'

/** Cadastro dos clientes Facility atendidos: logo e dados que saem nas ordens de serviço (PDF) de cada cliente. */
export default async function ClientesFacilityPage() {
  const appUser = await getAppUser()
  if (!appUser || (appUser.role !== 'admin' && appUser.role !== 'super_admin') || !appUser.orgId) redirect('/dashboard')
  const supabase = await createClient()
  const { data, error } = await supabase.from('client_company_profiles').select(CLIENT_PROFILE_COLUMNS).eq('org_id', appUser.orgId).order('name')
  const profiles = (data ?? []) as ClientProfile[]
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="clientes"
        title="Clientes Facility"
        subtitle="Cadastre cada cliente atendido com a logo e os dados dele. Todas as ordens de serviço (PDF) daquele cliente saem com essas informações."
      />
      {error ? (
        <p className="rounded-xl p-4 text-sm text-amber-300" style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)' }}>
          O cadastro de clientes ainda não está disponível. Fale com a equipe Alizo.
        </p>
      ) : (
        <ClientProfilesManager initialProfiles={profiles} />
      )}
    </div>
  )
}
