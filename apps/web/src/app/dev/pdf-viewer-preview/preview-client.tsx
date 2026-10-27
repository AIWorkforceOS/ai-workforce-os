'use client'

import { useEffect, useState } from 'react'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { PdfViewerOverlay } from '@/components/portal-funcionario/pdf-viewer-overlay'

/** PDF de exemplo no tamanho carta, com 2 páginas, texto em vários tamanhos e uma "caixa" na borda direita (mostra se algo é cortado). */
async function samplePdf(): Promise<File> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  for (const n of [1, 2]) {
    const page = doc.addPage([612, 792])
    page.drawText(`Sign Off Sheet — página ${n}`, { x: 40, y: 740, size: 22, font: bold })
    for (let i = 0; i < 22; i += 1) page.drawText(`Linha ${i + 1}: texto de exemplo do escopo do trabalho, para conferir a leitura no zoom.`, { x: 40, y: 700 - i * 24, size: 11, font, color: rgb(0.1, 0.1, 0.1) })
    page.drawRectangle({ x: 520, y: 40, width: 60, height: 60, borderColor: rgb(0.9, 0.1, 0.1), borderWidth: 2 })
    page.drawText('borda', { x: 528, y: 66, size: 10, font })
  }
  const bytes = await doc.save()
  return new File([new Uint8Array(bytes)], 'SignOff_PO-teste.pdf', { type: 'application/pdf' })
}

export function PreviewClient() {
  const [file, setFile] = useState<File | null>(null)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    void samplePdf().then(setFile)
  }, [])
  return (
    <div className="p-4">
      <button type="button" disabled={!file} onClick={() => setOpen(true)} className="rounded-xl px-4 py-3 text-sm font-bold text-white" style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)' }}>
        Abrir Sign Off de exemplo
      </button>
      {open && file && <PdfViewerOverlay file={file} onClose={() => setOpen(false)} title="Sign Off de exemplo" />}
    </div>
  )
}
