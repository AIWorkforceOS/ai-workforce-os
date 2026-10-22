import { ChevronLeft, Download, MapPin } from 'lucide-react'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getAppUser } from '@/lib/app-user'
import { createServiceClient } from '@/lib/supabase/service'
import { fetchClientOrderById, type ClientPortalOrderStatus } from '@/lib/portal-360/data'
import { Badge, Card, PageHeader, type BadgeVariant } from '@/components/ui/dashboard-ui'
import { PhotoGallery } from '@/components/portal-360/photo-gallery'
import { DownloadOriginalButton } from '@/components/portal-360/download-original-button'
import { ClientQuoteView } from '@/components/portal-360/client-quote-view'
import { stageOf, STAGE_LABEL, formatUsd } from '@/lib/portal-360/dashboard'

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
        action={<Badge variant={STATUS_VARIANT[order.status]}>{STAGE_LABEL[stageOf(order, new Date())]}</Badge>}
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
          {(order.status === 'completed' || order.status === 'quote') && (
            <a
              href={`/api/portal-360/orders/${order.id}/pdf`}
              className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold text-white transition-colors"
              style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)' }}
            >
              <Download size={13} />
              {order.status === 'quote' ? 'Download PDF (with quote)' : 'Download signed PDF'}
            </a>
          )}
        </div>
      </Card>

      {order.clientRequest && (order.clientRequest.description || order.clientRequest.approvedAmount != null || order.clientRequest.approvedHours != null || order.priority) && (
        <Card>
          <p className="mb-3 text-[11px] font-black uppercase tracking-wider text-slate-400">Your request</p>
          <div className="flex flex-col gap-2 text-sm">
            {order.priority && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-400">Priority</span>
                <span className="font-semibold text-white">{order.priority}</span>
              </div>
            )}
            {order.clientRequest.approvedAmount != null && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-400">Approved amount</span>
                <span className="font-semibold text-white">{formatUsd(order.clientRequest.approvedAmount)}</span>
              </div>
            )}
            {order.clientRequest.approvedHours != null && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-400">Approved time</span>
                <span className="font-semibold text-white">{order.clientRequest.approvedHours} h</span>
              </div>
            )}
            {order.clientRequest.description && <p className="whitespace-pre-wrap border-t pt-3 text-slate-200" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>{order.clientRequest.description}</p>}
          </div>
        </Card>
      )}

      <Card>
        <p className="mb-4 text-[11px] font-black uppercase tracking-wider text-slate-400">Photos</p>
        <PhotoGallery photos={[...(order.clientRequest?.photos ?? []).map((url) => ({ url, kind: 'service' as const, uploaded_at: order.createdAt })), ...order.photos]} />
      </Card>

      {order.status === 'quote' && (
        <ClientQuoteView
          appointmentId={order.id}
          description={order.quoteDescriptionEn}
          items={order.quoteItems}
          materialValue={order.materialValue}
          hoursNeeded={order.hoursNeeded}
          partLink={order.partPurchaseLink}
          approvedAmount={order.clientRequest?.approvedAmount ?? null}
          approvedHours={order.clientRequest?.approvedHours ?? null}
          decision={order.quoteDecision}
          decidedAt={order.quoteDecidedAt}
          stageLabel={STAGE_LABEL[stageOf(order, new Date())]}
        />
      )}
    </div>
  )
}
