import { FileText, MapPin } from 'lucide-react'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getAppUser } from '@/lib/app-user'
import { fetchPortalAppointmentById } from '@/lib/portal-funcionario/data'
import { ServiceOrderWorkspace } from '@/components/portal-funcionario/service-order-workspace'

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
  const appointment = await fetchPortalAppointmentById(supabase, appUser.employeeId, appointmentId)

  if (!appointment) notFound()

  const hasOrder = Boolean(
    appointment.service_order_number || appointment.service_order_file_url || appointment.service_order_summary_pt,
  )
  if (!hasOrder) redirect('/portal-funcionario')

  const locale = 'pt-BR'

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 pb-4">
      <Link
        href="/portal-funcionario"
        className="flex w-fit items-center gap-1 text-xs font-bold text-slate-400 hover:text-slate-200"
      >
        ← Voltar para a agenda
      </Link>

      <div className="rounded-2xl p-4" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
        <p className="text-[11px] font-black uppercase tracking-[0.15em] text-cyan-300">
          Ordem de serviço {appointment.service_order_number ? `Nº ${appointment.service_order_number}` : ''}
        </p>
        <p className="mt-1 text-base font-bold text-white">
          {appointment.customers?.name ?? 'Cliente'} {appointment.services?.name ? `· ${appointment.services.name}` : ''}
        </p>
        <p className="mt-1 text-xs text-slate-400">
          {new Date(appointment.starts_at).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' })}
        </p>
        {appointment.address && (
          <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-400">
            <MapPin size={12} />
            {appointment.address}
          </p>
        )}
        {appointment.service_order_summary_pt && <p className="mt-3 text-sm text-slate-300">{appointment.service_order_summary_pt}</p>}
        {appointment.service_order_file_url && (
          <a
            href={appointment.service_order_file_url}
            target="_blank"
            rel="noreferrer"
            className="mt-3 flex w-fit items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold text-cyan-300 transition-colors hover:text-cyan-200"
            style={{ background: 'rgba(6,182,212,0.08)', border: '1px solid rgba(6,182,212,0.25)' }}
          >
            <FileText size={13} />
            {appointment.service_order_file_name || 'Ver arquivo original da ordem'}
          </a>
        )}
      </div>

      <ServiceOrderWorkspace appointment={appointment} />
    </div>
  )
}
