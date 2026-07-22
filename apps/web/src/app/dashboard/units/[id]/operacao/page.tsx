import Link from 'next/link'
import { notFound } from 'next/navigation'
import { CalendarDays, Users } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui/dashboard-ui'
import { ServiceOperationsPanel } from '@/components/dashboard/service-operations-panel'
import type {
  InvoiceWithRelations,
  ServiceRecordWithRelations,
} from '@/components/dashboard/service-operations-panel'
import { unitDefaultLocale } from '@/lib/i18n/config'
import type { Customer, Employee, Service, Unit } from '@/lib/types'

/**
 * Operação da unidade (migration 030): serviços executados + valores a
 * pagar por profissional + faturas para o cliente final. Fecha o ciclo
 * agenda → execução → pagamento do técnico → cobrança do cliente.
 */
export default async function UnitOperationsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: unit } = await supabase.from('units').select('*').eq('id', id).single()
  if (!unit) notFound()
  const unitRow = unit as Unit

  const [{ data: employees }, { data: services }, { data: customers }, { data: records }, { data: invoices }] =
    await Promise.all([
      supabase.from('employees').select('*').eq('unit_id', id).eq('is_active', true).order('name'),
      supabase.from('services').select('*').eq('unit_id', id).eq('is_active', true).order('name'),
      supabase.from('customers').select('id, name, email, address').eq('unit_id', id).eq('status', 'active').order('name').limit(500),
      supabase
        .from('service_records')
        .select('*, employee:employees(id,name), customer:customers(id,name,email), service:services(id,name)')
        .eq('unit_id', id)
        .order('service_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(200),
      supabase
        .from('invoices')
        .select('*, customer:customers(id,name,email)')
        .eq('unit_id', id)
        .order('created_at', { ascending: false })
        .limit(100),
    ])

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="operação"
        title={`Operação — ${unitRow.name}`}
        subtitle="Serviços executados, valores a pagar por profissional e faturas para seus clientes."
        action={
          <div className="flex items-center gap-2">
            <Link
              href="/dashboard/employees"
              className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold text-slate-300 transition-all hover:bg-white/5"
              style={{ border: '1px solid rgba(255,255,255,0.08)' }}
            >
              <Users size={13} />
              Equipe
            </Link>
            <Link
              href={`/dashboard/units/${id}/agenda/calendario`}
              className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold text-slate-300 transition-all hover:bg-white/5"
              style={{ border: '1px solid rgba(255,255,255,0.08)' }}
            >
              <CalendarDays size={13} />
              Calendário
            </Link>
          </div>
        }
      />

      {unitRow.org_id ? (
        <ServiceOperationsPanel
          unitId={unitRow.id}
          orgId={unitRow.org_id}
          timezone={unitRow.timezone}
          currency={unitDefaultLocale(unitRow) === 'en' ? 'USD' : 'BRL'}
          employees={(employees ?? []) as Employee[]}
          services={(services ?? []) as Service[]}
          customers={(customers ?? []) as Pick<Customer, 'id' | 'name' | 'email' | 'address'>[]}
          initialRecords={(records ?? []) as unknown as ServiceRecordWithRelations[]}
          initialInvoices={(invoices ?? []) as unknown as InvoiceWithRelations[]}
        />
      ) : (
        <p className="text-sm text-amber-400">
          Esta unidade não está vinculada a uma empresa (org_id vazio) — a Operação exige esse vínculo.
        </p>
      )}
    </div>
  )
}
