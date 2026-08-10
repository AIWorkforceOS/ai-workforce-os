'use client'

import { Download } from 'lucide-react'
import { downloadFile } from '@/lib/download-file'
import type { PortalServiceOrderPhoto } from '@/lib/portal-funcionario/data'

function PhotoGrid({ photos, altPrefix }: { photos: PortalServiceOrderPhoto[]; altPrefix: string }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {photos.map((photo, index) => (
        <div key={photo.url + index} className="group relative overflow-hidden rounded-xl" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
          <a href={photo.url} target="_blank" rel="noreferrer">
            <img src={photo.url} alt={`${altPrefix} ${index + 1}`} className="aspect-square w-full object-cover" />
          </a>
          <button
            type="button"
            onClick={() => downloadFile(photo.url, `${altPrefix.toLowerCase().replace(/\s+/g, '-')}-${index + 1}.jpg`)}
            className="absolute bottom-1.5 right-1.5 flex h-7 w-7 items-center justify-center rounded-lg text-white transition-opacity"
            style={{ background: 'rgba(10,15,30,0.75)' }}
            aria-label={`Download ${altPrefix} ${index + 1}`}
          >
            <Download size={13} />
          </button>
        </div>
      ))}
    </div>
  )
}

/**
 * Fotos antes/depois do trabalho, separadas visualmente — pedido
 * direto do dono do produto. `kind` ausente ou 'service' = fotos
 * salvas antes da migration 061 (sem essa distinção ainda), mostradas
 * à parte pra não sumir de ordens antigas.
 */
export function PhotoGallery({ photos }: { photos: PortalServiceOrderPhoto[] }) {
  const before = photos.filter((p) => p.kind === 'before')
  const after = photos.filter((p) => p.kind === 'after')
  const unclassified = photos.filter((p) => !p.kind || p.kind === 'service')

  if (photos.length === 0) {
    return <p className="text-sm text-slate-500">No photos uploaded yet.</p>
  }

  return (
    <div className="flex flex-col gap-5">
      {before.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-[11px] font-black uppercase tracking-wider text-slate-400">Before</p>
          <PhotoGrid photos={before} altPrefix="Before" />
        </div>
      )}
      {after.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-[11px] font-black uppercase tracking-wider text-slate-400">After</p>
          <PhotoGrid photos={after} altPrefix="After" />
        </div>
      )}
      {unclassified.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-[11px] font-black uppercase tracking-wider text-slate-400">Other photos</p>
          <PhotoGrid photos={unclassified} altPrefix="Photo" />
        </div>
      )}
    </div>
  )
}
