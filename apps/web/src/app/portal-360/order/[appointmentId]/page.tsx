import { ChevronLeft, Download, MapPin } from 'lucide-react'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getAppUser } from '@/lib/app-user'
import { createServiceClient } from '@/lib/supabase/service'
import { fetchClientOrderById, type ClientPortalOrderStatus } from '@/lib/portal-360/data'
import { Badge, Card, PageHeader, type BadgeVariant } from '@/components/ui/dashboard-ui'
import { PhotoGallery } from '@/components/portal-360/photo-gallery'
import { DownloadOriginalButton } from '@/components/portal-360/download-original-button'

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
  return date.toLocaleDateString('en-US', { month: 'long', day: '2-digit', year: 'numeric' })
}

// force-dynamic: mesmo motivo das outras telas do portal — sem isso, o status
// pode ficar desatualizado depois que o admin atribui/finaliza (Data Cache do Next).
export const dynamic = 'force-dynamic'

export default async function Portal360OrderPage({ params }: { params: Promise<{ appointmentId: string }> }) {
  const { appointmentId } = await params
  const appUser = await getAppUser()
  if (!appUser || appUser.role !== 'client' || !appUser.clientCompany) {
    redirect('/portal-360')
  }

  const supabase = createServiceClient()
  const order = supabase ? await fetchClientOrderById(supabase, appUser.clientCompany, appointmentId) : null
  if (!order) {
    notFound()
  }

  return (
    <div className="flex flex-col gap-5">
      <Link href="/portal-360" className="flex w-fit items-center gap-1 text-xs font-semibold text-slate-400 hover:text-white">
        <ChevronLeft size={14} />
        Back to orders
      </Link>

      <PageHeader
        eyebrow={order.orderNumber ? `Order #${order.orderNumber}` : 'Order'}
        title={order.locationName ?? 'Service order'}
        action={<Badge variant={STATUS_VARIANT[order.status]}>{STATUS_LABEL[order.status]}</Badge>}
      />

      <Card>
        <div className="flex flex-col gap-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-slate-400">
              {order.status === 'pending_assignment' ? 'Requested day' : 'Scheduled date'}
            </span>
            <span className="font-semibold text-white">
              {order.status === 'pending_assignment' ? formatDate(order.requestedDate) : formatDate(order.startsAt)}
            </span>
          </div>
          {order.address && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-400">Address</span>
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(order.address)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 font-semibold text-cyan-400 hover:underline"
              >
                <MapPin size={12} />
                {order.address}
              </a>
            </div>
          )}
          {order.scopeEn && (
            <div className="flex flex-col gap-1 border-t pt-3" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
              <span className="text-slate-400">Scope of work</span>
              <p className="text-slate-200">{order.scopeEn}</p>
            </div>
          )}
          {order.signedBy && (
            <div className="flex items-center justify-between gap-2 border-t pt-3" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
              <span className="text-slate-400">Signed by</span>
              <span className="font-semibold text-white">
                {order.signedBy}
                {order.signedAt ? ` · ${formatDate(order.signedAt)}` : ''}
              </span>
            </div>
          )}
        </div>

        <div className="mt-5 flex flex-wrap gap-2 border-t pt-4" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
          {order.fileUrl && <DownloadOriginalButton url={order.fileUrl} filename={order.fileName ?? 'service-order'} />}
          {order.status === 'completed' && (
            <a
              href={`/api/portal-360/orders/${order.id}/pdf`}
              className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold text-white transition-colors"
              style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)' }}
            >
              <Download size={13} />
              Download signed PDF
            </a>
          )}
        </div>
      </Card>

      <Card>
        <p className="mb-4 text-[11px] font-black uppercase tracking-wider text-slate-400">Photos</p>
        <PhotoGallery photos={order.photos} />
      </Card>
    </div>
  )
}
