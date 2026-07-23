import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/dashboard-ui'
import { CustomerDetailForm } from '@/components/dashboard/customer-detail-form'
import { CustomerAppointmentsPanel } from '@/components/dashboard/customer-appointments-panel'
import type { AppointmentWithRelations } from '@/components/dashboard/calendar-view'
import type { Customer, Employee, Service, Unit } from '@/lib/types'
import { fetchOrganizationManagementMode, fetchOrganizationVerticalKey } from '@/lib/organizations'
import { getBusinessHours, getSchedulingSettings } from '@/lib/scheduling'
import { ensureDefaultService } from '@/lib/scheduling/ensure-default-service'
import { getCustomerTerm } from '@/lib/verticals/terminology'
import { VERTICAL_TEMPLATES } from '@/lib/verticals/catalog'

export const dynamic = 'force-dynamic'

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: customer } = await supabase.from('customers').select('*').eq('id', id).maybeSingle()
  const customerRow = customer as Customer | null
  if (!customerRow) notFound()

  const { data: unit } = await supabase.from('units').select('*').eq('id', customerRow.unit_id).maybeSingle()
  const unitRow = unit as Unit | null

  const [verticalKey, managementMode] = await Promise.all([
    fetchOrganizationVerticalKey(supabase, customerRow.org_id),
    fetchOrganizationManagementMode(supabase, customerRow.org_id),
  ])
  const term = getCustomerTerm(verticalKey, 'pt')
  const termPlural = getCustomerTerm(verticalKey, 'pt', { plural: true })
  const customFieldSchema = verticalKey ? VERTICAL_TEMPLATES[verticalKey].customerFieldSchema : []
  const fullManagement = managementMode === 'full_management'

  // Modo gestão completa: a ficha do cliente também agenda/remarca serviços,
  // então carrega o contexto de agenda da unidade dele.
  const [{ data: services }, { data: employees }, { data: appointments }] = fullManagement && unitRow
    ? await Promise.all([
        supabase.from('services').select('*').eq('unit_id', unitRow.id).eq('is_active', true).order('name'),
        supabase
          .from('employees')
          .select('*')
          .eq('unit_id', unitRow.id)
          .eq('is_active', true)
          .eq('is_schedulable', true)
          .order('name'),
        supabase
          .from('appointments')
          .select('*, customer:customers(id,name,phone), service:services(id,name), employee:employees(id,name)')
          .eq('customer_id', customerRow.id)
          .order('starts_at', { ascending: false })
          .limit(20),
      ])
    : [{ data: null }, { data: null }, { data: null }]

  const servicesRows =
    fullManagement && unitRow ? await ensureDefaultService(supabase, unitRow, (services ?? []) as Service[]) : []

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <Link
          href="/dashboard/receptionist/customers"
          className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-400 hover:text-slate-200"
        >
          <ArrowLeft size={12} /> Voltar pra {termPlural.toLowerCase()}
        </Link>
        <h1 className="mt-2 text-2xl font-black tracking-tight text-white">{customerRow.name}</h1>
        <p className="mt-0.5 text-sm text-slate-400">
          {unitRow?.name ?? 'Unidade não encontrada'}
          {customerRow.source === 'sales' && ' · veio de um negócio fechado pelo AI Sales Representative'}
        </p>
      </div>

      {fullManagement && unitRow && unitRow.org_id && (
        <Card className="p-6">
          <CustomerAppointmentsPanel
            customer={customerRow}
            unitId={unitRow.id}
            orgId={unitRow.org_id}
            timezone={unitRow.timezone}
            businessHours={getBusinessHours(unitRow)}
            schedulingSettings={getSchedulingSettings(unitRow)}
            services={servicesRows}
            employees={(employees ?? []) as Employee[]}
            initialAppointments={(appointments ?? []) as unknown as AppointmentWithRelations[]}
          />
        </Card>
      )}

      <Card className="p-6">
        <CustomerDetailForm
          customer={customerRow}
          customerTerm={term}
          customFieldSchema={customFieldSchema}
          showServiceFields={fullManagement}
        />
      </Card>
    </div>
  )
}
