import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ClipboardList, MapPin } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getAppUser } from '@/lib/app-user'
import { Card, EmptyState, PageHeader } from '@/components/ui/dashboard-ui'

type UnitRow = {
  id: string
  name: string
  region_city: string | null
  region_state: string | null
  organizations: { name: string } | null
}

/**
 * Hub do item "Operação de serviços" do menu lateral. A tela de Operação
 * é por unidade (/dashboard/units/[id]/operacao); este hub só resolve
 * PARA QUAL unidade ir: dono de unidade e org com uma unidade só vão
 * direto, org com várias escolhe aqui.
 */
export default async function OperationsHubPage() {
  const appUser = await getAppUser()
  if (appUser?.unitId) {
    redirect(`/dashboard/units/${appUser.unitId}/operacao`)
  }

  const supabase = await createClient()
  const { data } = await supabase
    .from('units')
    .select('id, name, region_city, region_state, organizations(name)')
    .eq('is_active', true)
    .order('name')
  const units = (data ?? []) as unknown as UnitRow[]

  if (units.length === 1) {
    redirect(`/dashboard/units/${units[0]!.id}/operacao`)
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="operação"
        title="Operação de serviços"
        subtitle="Serviços executados, valores a pagar por profissional e faturas — escolha a unidade."
      />

      {units.length === 0 ? (
        <Card className="overflow-hidden">
          <EmptyState
            icon={<ClipboardList size={22} className="text-white" />}
            title="Nenhuma unidade ativa"
            subtitle="Cadastre uma unidade para usar a operação de serviços."
            actionHref="/dashboard/units"
            actionLabel="Ir para unidades"
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {units.map((unit) => (
            <Link key={unit.id} href={`/dashboard/units/${unit.id}/operacao`}>
              <Card className="p-5 transition-all hover:scale-[1.01]">
                <p className="font-bold text-white">{unit.name}</p>
                <p className="mt-1 text-xs text-slate-500">{unit.organizations?.name ?? ''}</p>
                {(unit.region_city || unit.region_state) && (
                  <p className="mt-2 flex items-center gap-1 text-xs text-slate-400">
                    <MapPin size={11} />
                    {[unit.region_city, unit.region_state].filter(Boolean).join(', ')}
                  </p>
                )}
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
