import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui/dashboard-ui'
import { FacilitOrdersPanel } from '@/components/dashboard/facilit-orders-panel'
import type { Unit } from '@/lib/types'

export const dynamic = 'force-dynamic'

/**
 * Credenciais + sync da Facil-IT/360 pra essa unidade (integração Mawi
 * Pro, 2026-09-10, revisada 2026-09-15). As ordens importadas vão
 * direto pra Agenda de verdade (`appointments`, ver facilit-sync.ts +
 * migration 081) — o cliente atribui técnico e confirma horário pela
 * própria tela de agenda (mesmo fluxo do Portal 360), não aqui.
 */
export default async function UnitFacilitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: unit } = await supabase.from('units').select('*').eq('id', id).single()
  if (!unit) notFound()
  const unitRow = unit as Unit

  const { data: credential } = await supabase
    .from('facilit_credentials')
    .select('client_code, username, is_active, last_synced_at, last_sync_error')
    .eq('unit_id', id)
    .maybeSingle()

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="facil-it"
        title={`Facil-IT — ${unitRow.name}`}
        subtitle="Conecta com a Facil-IT e importa as ordens do dia e do dia seguinte direto pra Agenda."
      />
      <FacilitOrdersPanel unitId={unitRow.id} initialCredential={credential ?? null} agendaHref={`/dashboard/units/${unitRow.id}/agenda/calendario`} />
    </div>
  )
}
