import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getAppUser } from '@/lib/app-user'
import { fetchEmployeeUnitContext, fetchPortalAppointmentById } from '@/lib/portal-funcionario/data'
import { ServiceOrderWorkspace } from '@/components/portal-funcionario/service-order-workspace'
import { FieldOrderShell } from '@/components/portal-funcionario/field-order-shell'
import { OrderHeader } from '@/components/portal-funcionario/order-header'
import { OfflineSnapshotWriter } from '@/components/portal-funcionario/offline-snapshot-writer'

/**
 * Página única e mobile-first pra trabalhar a ordem de serviço — pedido
 * direto do dono do produto depois de testar a Fase A (formulário
 * pequeno dentro do acordeão da agenda, ruim de usar em campo pelo
 * celular). Server Component: reaproveita fetchPortalAppointmentById
 * (mesma RLS de appointments_select da agenda, migration 053) em vez de
 * replicar a busca num client component. A mutação (assinar, tirar
 * fotos, finalizar/cotar) continua isolada no client component
 * (ServiceOrderWorkspace) + na rota PATCH já existente e testada
 * (lib/service-orders/finalize.ts).
 */

// force-dynamic: mesmo motivo da página principal do portal — sem isso,
// reabrir esta rota depois de salvar pode mostrar dado desatualizado
// por causa do Data Cache do Next.
export const dynamic = 'force-dynamic'

export default async function ServiceOrderWorkspacePage({
  params,
}: {
  params: Promise<{ appointmentId: string }>
}) {
  const { appointmentId } = await params
  const appUser = await getAppUser()

  if (!appUser || appUser.role !== 'employee' || !appUser.employeeId) {
    redirect('/login')
  }

  const supabase = await createClient()
  const [appointment, { requiresCheckin }] = await Promise.all([
    fetchPortalAppointmentById(supabase, appUser.employeeId, appointmentId),
    fetchEmployeeUnitContext(supabase, appUser.employeeId),
  ])

  if (!appointment) notFound()

  const hasOrder = Boolean(
    appointment.service_order_number || appointment.service_order_file_url || appointment.service_order_summary_pt,
  )
  if (!hasOrder) redirect('/portal-funcionario')

  const locale = 'pt-BR'

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 pb-4">
      <OfflineSnapshotWriter employeeId={appUser.employeeId} appointment={appointment} />
      <Link
        href="/portal-funcionario"
        className="flex w-fit items-center gap-1 text-xs font-bold text-slate-400 hover:text-slate-200"
      >
        ← Voltar para a agenda
      </Link>

      <OrderHeader appointment={appointment} locale={locale} />

      <FieldOrderShell
        requiresCheckin={requiresCheckin}
        unitId={appointment.unit_id}
        appointmentId={appointment.id}
        address={appointment.address}
        initial={{ trip_started_at: appointment.trip_started_at ?? null, checked_in_at: appointment.checked_in_at ?? null, work_ended_at: appointment.work_ended_at ?? null }}
      >
        <ServiceOrderWorkspace appointment={appointment} />
      </FieldOrderShell>
    </div>
  )
}
