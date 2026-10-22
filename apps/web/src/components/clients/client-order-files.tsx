'use client'

import { OpenPdfButton } from '@/components/portal-funcionario/open-pdf-button'
import type { OrderFiles } from '@/lib/clients/order-files'

/** "Relatório e anexos" de uma ordem no painel do cliente: Sign Off, relatório fotográfico, ordem original e link público. */
export function ClientOrderFiles({ unitId, appointmentId, orderNumber, files }: { unitId: string; appointmentId: string; orderNumber: string | null; files: OrderFiles }) {
  if (!files.hasSignOff && !files.hasPhotoReport && !files.original) return null
  const name = orderNumber ?? 'ordem'
  const link = 'rounded-lg px-2 py-1 text-[11px] font-bold text-cyan-300 hover:text-cyan-200'
  const linkStyle = { background: 'rgba(6,182,212,0.1)', border: '1px solid rgba(6,182,212,0.25)' }
  const c = files.photoCounts
  return (
    <details className="mt-2 rounded-lg" style={{ background: 'rgba(255,255,255,0.03)' }}>
      <summary className="cursor-pointer select-none px-2 py-1 text-[11px] font-bold text-slate-300">Relatório e anexos{files.photoTotal > 0 ? ` · ${files.photoTotal} arquivo(s) de mídia` : ''}</summary>
      <div className="flex flex-col gap-1.5 px-2 pb-2 pt-1">
        {files.photoTotal > 0 && (
          <p className="text-[11px] text-slate-400">
            Antes {c.before} · Depois {c.after} · Outras {c.other}
            {c.receipts > 0 ? ` · Notas ${c.receipts}` : ''}
            {c.videos > 0 ? ` · Vídeos ${c.videos}` : ''}
          </p>
        )}
        <div className="flex flex-wrap gap-1.5">
          {files.hasSignOff && (
            <OpenPdfButton url={`/api/units/${unitId}/appointments/${appointmentId}/service-order/pdf`} fallbackName={`SignOff_PO-${name}.pdf`} className={link} style={linkStyle}>
              Sign Off (PDF)
            </OpenPdfButton>
          )}
          {files.hasPhotoReport && (
            <OpenPdfButton url={`/api/units/${unitId}/appointments/${appointmentId}/service-order/pdf?report=photos`} fallbackName={`relatorio-fotografico-${name}.pdf`} className={link} style={linkStyle}>
              Relatório fotográfico
            </OpenPdfButton>
          )}
          {files.original && (
            <a href={files.original.url} target="_blank" rel="noopener noreferrer" className={link} style={linkStyle}>
              Ordem original
            </a>
          )}
          {files.reportToken && files.hasPhotoReport && (
            <a href={`/relatorio/${files.reportToken}`} target="_blank" rel="noopener noreferrer" className={link} style={linkStyle}>
              Link do cliente
            </a>
          )}
        </div>
      </div>
    </details>
  )
}
