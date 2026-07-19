import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/dashboard-ui'
import { CustomerDetailForm } from '@/components/dashboard/customer-detail-form'
import type { Customer, Unit } from '@/lib/types'
import { fetchOrganizationVerticalKey } from '@/lib/organizations'
import { getCustomerTerm } from '@/lib/verticals/terminology'
import { VERTICAL_TEMPLATES } from '@/lib/verticals/catalog'

export const dynamic = 'force-dynamic'

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: customer } = await supabase.from('customers').select('*').eq('id', id).maybeSingle()
  const customerRow = customer as Customer | null
  if (!customerRow) notFound()

  const { data: unit } = await supabase.from('units').select('id, name').eq('id', customerRow.unit_id).maybeSingle()
  const unitRow = unit as Pick<Unit, 'id' | 'name'> | null

  const verticalKey = await fetchOrganizationVerticalKey(supabase, customerRow.org_id)
  const term = getCustomerTerm(verticalKey, 'pt')
  const termPlural = getCustomerTerm(verticalKey, 'pt', { plural: true })
  const customFieldSchema = verticalKey ? VERTICAL_TEMPLATES[verticalKey].customerFieldSchema : []

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

      <Card className="p-6">
        <CustomerDetailForm customer={customerRow} customerTerm={term} customFieldSchema={customFieldSchema} />
      </Card>
    </div>
  )
}
