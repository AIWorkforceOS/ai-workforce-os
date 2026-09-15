import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Link2, MapPin } from 'lucide-react'
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
 * Hub do item "Facil-IT (360)" do menu lateral (2026-09-15) — mesmo
 * padrão do hub de Operação: dono de unidade e org com uma unidade só
 * vão direto pra `/dashboard/units/[id]/facilit`; org com várias
 * unidades escolhe aqui pra qual delas.
 */
export default async function FacilitHubPage() {
  const appUser = await getAppUser()
  if (appUser?.unitId) {
    redirect(`/dashboard/units/${appUser.unitId}/facilit`)
  }

  const supabase = await createClient()
  const { data } = await supabase
    .from('units')
    .select('id, name, region_city, region_state, organizations(name)')
    .eq('is_active', true)
    .order('name')
  const units = (data ?? []) as unknown as UnitRow[]

  if (units.length === 1) {
    redirect(`/dashboard/units/${units[0]!.id}/facilit`)
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="facil-it"
        title="Facil-IT (360)"
        subtitle="Importa as ordens do dia e do dia seguinte direto pra Agenda — escolha a unidade."
      />

      {units.length === 0 ? (
        <Card className="overflow-hidden">
          <EmptyState
            icon={<Link2 size={22} className="text-white" />}
            title="Nenhuma unidade ativa"
            subtitle="Cadastre uma unidade para usar a integração com a Facil-IT."
            actionHref="/dashboard/units"
            actionLabel="Ir para unidades"
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {units.map((unit) => (
            <Link key={unit.id} href={`/dashboard/units/${unit.id}/facilit`}>
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
