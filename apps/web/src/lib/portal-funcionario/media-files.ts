import type { PortalServiceOrderPhoto } from './data'

const KIND_NAME: Record<string, string> = { before: 'antes', after: 'depois', material_invoice: 'nota-fiscal', video: 'video' }

function extensionOf(url: string, kind: string | undefined): string {
  const clean = (url.split('?')[0] ?? '').toLowerCase()
  const match = clean.match(/\.([a-z0-9]{2,4})$/)
  if (match) return match[1]!
  return kind === 'video' ? 'mp4' : 'jpg'
}

/** Nome amigável de cada arquivo ao baixar: WO-antes-1.jpg, WO-depois-2.jpg, WO-video-1.mp4… */
export function mediaDownloadNames(media: PortalServiceOrderPhoto[], orderNumber: string | null): string[] {
  const prefix = (orderNumber ?? 'ordem').replace(/[^a-zA-Z0-9.\-_]/g, '_')
  const counters = new Map<string, number>()
  return media.map((item) => {
    const kind = KIND_NAME[item.kind ?? ''] ?? 'foto'
    const n = (counters.get(kind) ?? 0) + 1
    counters.set(kind, n)
    return `${prefix}-${kind}-${n}.${extensionOf(item.url, item.kind)}`
  })
}
