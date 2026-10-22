import { redirect } from 'next/navigation'
import { getAppUser } from '@/lib/app-user'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui/dashboard-ui'
import { StagesEditor } from '@/components/crm/stages-editor'
import type { StageRow } from '@/lib/crm/stages'

export const dynamic = 'force-dynamic'

/** Etapas do funil de vendas: nomear, reordenar, colorir e acrescentar etapas. Só o administrador completo (ou a função Comercial) da empresa. */
export default async function CrmStagesPage() {
  const appUser = await getAppUser()
  if (!appUser || appUser.role !== 'admin' || !appUser.orgId) redirect('/dashboard/crm')
  const supabase = await createClient()
  const { data, error } = await supabase.from('crm_stages').select('id, name, kind, color, position').eq('org_id', appUser.orgId).order('position')
  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow="vendas" title="Etapas do funil" subtitle="Monte o funil do seu jeito. Cada etapa conta como um dos comportamentos do sistema (Novo, Em contato, Convertido…), então agentes e métricas continuam funcionando." />
      {error ? (
        <p className="rounded-xl p-4 text-sm text-amber-300" style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)' }}>
          A personalização do funil ainda não está disponível. Fale com a equipe Alizo.
        </p>
      ) : (
        <StagesEditor orgId={appUser.orgId} initial={(data ?? []) as StageRow[]} />
      )}
    </div>
  )
}
