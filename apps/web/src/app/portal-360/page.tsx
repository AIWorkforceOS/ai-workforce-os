import { ClipboardList, Plus } from 'lucide-react'
import Link from 'next/link'
import { getAppUser } from '@/lib/app-user'
import { createServiceClient } from '@/lib/supabase/service'
import { fetchClientOrders, type ClientPortalOrder, type ClientPortalOrderStatus } from '@/lib/portal-360/data'
import { Badge, Card, EmptyState, PageHeader, PrimaryButton, type BadgeVariant } from '@/components/ui/dashboard-ui'

const STATUS_LABEL: Record<ClientPortalOrderStatus, string> = {
  pending_assignment: 'Pending scheduling',
  scheduled: 'Scheduled',
  completed: 'Completed',
  quote: 'Quote',
  cancelled: 'Cancelled',
}

const STATUS_VARIANT: Record<ClientPortalOrderStatus, BadgeVariant> = {
  pending_assignment: 'amber',
  scheduled: 'blue',
  completed: 'green',
  quote: 'purple',
  cancelled: 'red',
}

function formatDate(iso: string | null): string {
  if (!iso) return '-'
  const date = iso.length === 10 ? new Date(`${iso}T00:00:00`) : new Date(iso)
  return date.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })
}

function orderDateLabel(order: ClientPortalOrder): string {
  if (order.status === 'pending_assignment') return `Requested for ${formatDate(order.requestedDate)}`
  return formatDate(order.startsAt)
}

// force-dynamic: mesmo motivo do Portal do Funcionário — sem isso, anexar uma
// ordem nova e voltar pra lista pode mostrar dado desatualizado (Data Cache do Next).
export const dynamic = 'force-dynamic'

export default async function Portal360Page() {
  const appUser = await getAppUser()
  if (!appUser || appUser.role !== 'client' || !appUser.clientCompany) {
    return null
  }

  const supabase = createServiceClient()
  const orders = supabase ? await fetchClientOrders(supabase, appUser.clientCompany) : []

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Service orders"
        title="Your orders"
        subtitle="All stores, all locations — attach a new order or track an existing one."
        action={
          <PrimaryButton href="/portal-360/new" icon={<Plus size={14} />}>
            New order
          </PrimaryButton>
        }
      />

      {orders.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ClipboardList size={22} className="text-white" />}
            title="No orders yet"
            subtitle="Attach your first service order to get started."
            actionHref="/portal-360/new"
            actionLabel="Attach order"
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="flex flex-col">
            {orders.map((order) => (
              <Link
                key={order.id}
                href={`/portal-360/order/${order.id}`}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 transition-colors hover:bg-white/[0.03]"
                style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}
              >
                <div className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-white">
                      {order.orderNumber ? `#${order.orderNumber}` : 'Order'}
                    </span>
                    <Badge variant={STATUS_VARIANT[order.status]}>{STATUS_LABEL[order.status]}</Badge>
                  </div>
                  <p className="text-xs text-slate-400">
                    {order.locationName ?? 'Location not specified'}
                    {order.address ? ` · ${order.address}` : ''}
                  </p>
                </div>
                <span className="text-xs font-semibold text-slate-400">{orderDateLabel(order)}</span>
              </Link>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}
