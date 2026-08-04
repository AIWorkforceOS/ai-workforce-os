import { CalendarClock, Wallet } from 'lucide-react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getAppUser } from '@/lib/app-user'
import { fetchEmployeePortalData, PORTAL_DATA_SINCE } from '@/lib/portal-funcionario/data'
import { Badge, Card, CardHeader, EmptyState, PageHeader, type BadgeVariant } from '@/components/ui/dashboard-ui'

const APPOINTMENT_STATUS_LABEL: Record<string, string> = {
  scheduled: 'Agendado',
  confirmed: 'Confirmado',
  completed: 'Concluído',
  cancelled: 'Cancelado',
  no_show: 'Faltou',
}

const APPOINTMENT_STATUS_VARIANT: Record<string, BadgeVariant> = {
  scheduled: 'blue',
  confirmed: 'cyan',
  completed: 'green',
  cancelled: 'slate',
  no_show: 'red',
}

const PAYMENT_STATUS_LABEL: Record<string, string> = {
  pending: 'Pendente',
  paid: 'Pago',
}

const PAYMENT_STATUS_VARIANT: Record<string, BadgeVariant> = {
  pending: 'amber',
  paid: 'green',
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('pt-BR', { dateStyle: 'short' })
}

function formatCurrency(value: number | null): string {
  if (value === null) return '—'
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export default async function PortalFuncionarioPage() {
  const appUser = await getAppUser()

  // Guarda já é aplicada no layout, mas sem employeeId não há o que buscar.
  if (!appUser || appUser.role !== 'employee' || !appUser.employeeId) {
    redirect('/login')
  }

  const supabase = await createClient()
  const { appointments, serviceRecords } = await fetchEmployeePortalData(supabase, appUser.employeeId)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="portal do funcionário"
        title={`Olá, ${appUser.name?.split(' ')[0] ?? 'funcionário'}`}
        subtitle={`Sua agenda e seus valores lançados a partir de ${formatDate(PORTAL_DATA_SINCE)}.`}
      />

      <Card className="overflow-hidden">
        <div className="p-5">
          <CardHeader eyebrow="agenda" title="Seus agendamentos" />
        </div>
        {appointments.length === 0 ? (
          <EmptyState
            icon={<CalendarClock size={22} className="text-white" />}
            title="Nenhum agendamento ainda"
            subtitle="Quando a unidade agendar um trabalho no seu nome, ele aparece aqui."
          />
        ) : (
          <div className="flex flex-col divide-y" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
            {appointments.map((appt) => (
              <div key={appt.id} className="flex flex-col gap-1 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-white">
                    {appt.customers?.name ?? 'Cliente'} {appt.services?.name ? `· ${appt.services.name}` : ''}
                  </p>
                  <p className="mt-0.5 text-[12px] text-slate-400">{formatDateTime(appt.starts_at)}</p>
                  {appt.address && <p className="text-[11px] text-slate-500">{appt.address}</p>}
                </div>
                <Badge variant={APPOINTMENT_STATUS_VARIANT[appt.status] ?? 'slate'}>
                  {APPOINTMENT_STATUS_LABEL[appt.status] ?? appt.status}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="overflow-hidden">
        <div className="p-5">
          <CardHeader eyebrow="financeiro" title="Seus valores lançados" />
        </div>
        {serviceRecords.length === 0 ? (
          <EmptyState
            icon={<Wallet size={22} className="text-white" />}
            title="Nenhum lançamento ainda"
            subtitle="Quando a unidade lançar um serviço executado por você, o valor aparece aqui."
          />
        ) : (
          <div className="flex flex-col divide-y" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
            {serviceRecords.map((rec) => (
              <div key={rec.id} className="flex flex-col gap-1 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-white">
                    {rec.customers?.name ?? rec.description ?? 'Serviço'}
                  </p>
                  <p className="mt-0.5 text-[12px] text-slate-400">{formatDate(rec.service_date)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-white">{formatCurrency(rec.amount_due)}</span>
                  <Badge variant={PAYMENT_STATUS_VARIANT[rec.payment_status] ?? 'slate'}>
                    {PAYMENT_STATUS_LABEL[rec.payment_status] ?? rec.payment_status}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
