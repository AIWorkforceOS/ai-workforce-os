import type { Metadata } from 'next'
import { createServiceClient } from '@/lib/supabase/service'
import { isReportToken } from '@/lib/service-orders/report-link'
import { MediaDownloadPanel } from '@/components/portal-funcionario/media-download-panel'
import type { PortalServiceOrderPhoto } from '@/lib/portal-funcionario/data'

export const dynamic = 'force-dynamic'
// Página do cliente final: não indexa, não vaza o endereço de origem do link.
export const metadata: Metadata = { title: 'Photographic Report', robots: { index: false, follow: false }, referrer: 'no-referrer' }

type ReportRow = {
  service_order_number: string | null
  service_order_client_po: string | null
  service_order_location_name: string | null
  starts_at: string
  service_order_photos: PortalServiceOrderPhoto[] | null
}

const SECTIONS: { title: string; match: (p: PortalServiceOrderPhoto) => boolean }[] = [
  { title: 'Before', match: (p) => p.kind === 'before' },
  { title: 'After', match: (p) => p.kind === 'after' },
  { title: 'Other photos', match: (p) => !p.kind || p.kind === 'service' },
  { title: 'Material receipts', match: (p) => p.kind === 'material_invoice' },
]

/**
 * Relatório fotográfico para o CLIENTE (sem login): o PDF do Sign Off traz um botão
 * que abre aqui. Mostra só o necessário (nº da ordem, PO, local, data, fotos e vídeos);
 * nada de endereço, valores ou dados internos. Acesso por token aleatório por ordem
 * (appointments.public_report_token, migration 090).
 */
export default async function PublicReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const supabase = createServiceClient()
  const row =
    supabase && isReportToken(token)
      ? ((
          await supabase
            .from('appointments')
            .select('service_order_number, service_order_client_po, service_order_location_name, starts_at, service_order_photos')
            .eq('public_report_token', token)
            .maybeSingle()
        ).data as ReportRow | null)
      : null

  if (!row) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <p className="text-sm text-slate-400">Report not found.</p>
      </div>
    )
  }

  const media = row.service_order_photos ?? []
  const videos = media.filter((p) => p.kind === 'video')
  const date = new Date(row.starts_at).toLocaleDateString('en-US', { timeZone: 'America/New_York' })

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-black text-white">Photographic Report</h1>
        <p className="text-sm text-slate-400">
          {[row.service_order_number ? `Work Order # ${row.service_order_number}` : null, row.service_order_client_po ? `PO # ${row.service_order_client_po}` : null]
            .filter(Boolean)
            .join('  ·  ')}
        </p>
        <p className="text-sm text-slate-400">{[row.service_order_location_name, date].filter(Boolean).join('  ·  ')}</p>
      </header>

      {media.length === 0 ? (
        <p className="text-sm text-slate-400">No photos or videos were attached to this order.</p>
      ) : (
        <>
          <MediaDownloadPanel media={media} orderNumber={row.service_order_number} locale="en" />

          {SECTIONS.map((section) => {
            const items = media.filter((p) => p.kind !== 'video' && section.match(p))
            if (items.length === 0) return null
            return (
              <section key={section.title} className="flex flex-col gap-2">
                <h2 className="text-xs font-black uppercase tracking-wider text-slate-300">
                  {section.title} ({items.length})
                </h2>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {items.map((photo, i) => (
                    <a key={i} href={photo.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg" style={{ border: '1px solid rgba(255,255,255,0.1)' }}>
                      <img src={photo.url} alt={`${section.title} photo ${i + 1}`} loading="lazy" className="aspect-square w-full object-cover" />
                    </a>
                  ))}
                </div>
              </section>
            )
          })}

          {videos.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="text-xs font-black uppercase tracking-wider text-slate-300">Videos ({videos.length})</h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {videos.map((video, i) => (
                  <video key={i} src={video.url} controls playsInline preload="metadata" className="w-full rounded-lg bg-black" />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </main>
  )
}
