import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui/dashboard-ui'
import { FacilitOrdersPanel } from '@/components/dashboard/facilit-orders-panel'
import type { Unit } from '@/lib/types'

export const dynamic = 'force-dynamic'

/**
 * Ordens de serviço da Facil-IT/360 pra essa unidade (integração Mawi Pro,
 * 2026-09-10). Ver facilit-orders-panel.tsx pro fluxo de credenciais/sync/
 * atribuição de técnico.
 */
export default async function UnitFacilitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: unit } = await supabase.from('units').select('*').eq('id', id).single()
  if (!unit) notFound()
  const unitRow = unit as Unit

  const [{ data: credential }, { data: orders }, { data: technicians }] = await Promise.all([
    supabase
      .from('facilit_credentials')
      .select('client_code, username, is_active, last_synced_at, last_sync_error')
      .eq('unit_id', id)
      .maybeSingle(),
    supabase
      .from('facilit_work_orders')
      .select(
        'id, facilit_order_number, po_number, company, address1, city, state, category, order_type, priority, status, visit_date, assigned_employee_id',
      )
      .eq('unit_id', id)
      .order('visit_date', { ascending: true }),
    supabase.from('employees').select('id, name').eq('unit_id', id).eq('role', 'technician').eq('is_active', true).order('name'),
  ])

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="facil-it"
        title={`Facil-IT — ${unitRow.name}`}
        subtitle="Ordens de serviço do dia e do dia seguinte, importadas automaticamente da rede 360."
      />
      <FacilitOrdersPanel
        unitId={unitRow.id}
        initialCredential={credential ?? null}
        initialOrders={orders ?? []}
        technicians={technicians ?? []}
      />
    </div>
  )
}
