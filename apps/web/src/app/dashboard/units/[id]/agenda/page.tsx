import Link from 'next/link'
import { notFound } from 'next/navigation'
import { CalendarDays } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { ensureDefaultService } from '@/lib/scheduling/ensure-default-service'
import { SchedulingConfigForm } from '@/components/dashboard/scheduling-config-form'
import { ServicesPanel } from '@/components/dashboard/services-panel'
import { ResourcesPanel } from '@/components/dashboard/resources-panel'
import { EmployeeSchedulingPanel } from '@/components/dashboard/employee-scheduling-panel'
import { Card, PageHeader, SectionLabel } from '@/components/ui/dashboard-ui'
import type { Employee, Resource, Service, Unit } from '@/lib/types'

export default async function UnitAgendaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const [{ data: unit }, { data: services }, { data: resources }, { data: employees }] = await Promise.all([
    supabase.from('units').select('*').eq('id', id).single(),
    supabase.from('services').select('*').eq('unit_id', id).order('created_at', { ascending: false }),
    supabase.from('resources').select('*').eq('unit_id', id).order('created_at', { ascending: false }),
    supabase.from('employees').select('*').eq('unit_id', id).eq('is_active', true).order('name'),
  ])

  if (!unit) {
    notFound()
  }

  const unitRow = unit as Unit
  const servicesRows = await ensureDefaultService(supabase, unitRow, (services ?? []) as Service[])
  const resourcesRows = (resources ?? []) as Resource[]
  const employeesRows = (employees ?? []) as Employee[]

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="agenda inteligente"
        title={`Agenda — ${unitRow.name}`}
        subtitle="Horário de funcionamento, serviços, salas/equipamentos e profissionais que atendem agenda."
        action={
          <Link
            href={`/dashboard/units/${unitRow.id}/agenda/calendario`}
            className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-bold text-white transition-all hover:scale-[1.02] active:scale-[0.98]"
            style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)', boxShadow: '0 4px 14px rgba(6,182,212,0.3)' }}
          >
            <CalendarDays size={14} />
            Ver calendário
          </Link>
        }
      />

      <SchedulingConfigForm unit={unitRow} />

      {unitRow.org_id ? (
        <>
          <div className="flex flex-col gap-3">
            <SectionLabel>Serviços</SectionLabel>
            <ServicesPanel unitId={unitRow.id} orgId={unitRow.org_id} initialServices={servicesRows} />
          </div>

          <div className="flex flex-col gap-3">
            <SectionLabel>Salas e equipamentos</SectionLabel>
            <ResourcesPanel unitId={unitRow.id} orgId={unitRow.org_id} initialResources={resourcesRows} />
          </div>
        </>
      ) : (
        <Card className="px-6 py-4 text-sm text-amber-400">
          Esta unidade não está vinculada a uma empresa (org_id vazio) — serviços e recursos exigem esse
          vínculo antes de serem cadastrados.
        </Card>
      )}

      <div className="flex flex-col gap-3">
        <SectionLabel>Profissionais e disponibilidade</SectionLabel>
        <EmployeeSchedulingPanel initialEmployees={employeesRows} />
      </div>
    </div>
  )
}
