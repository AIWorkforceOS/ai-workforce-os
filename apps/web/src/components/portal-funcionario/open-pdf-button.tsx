'use client'

import { useState, type CSSProperties, type ReactNode } from 'react'
import { fetchPdf, type SignOffFile } from '@/lib/portal-funcionario/signoff-download'
import { PdfViewerOverlay } from './pdf-viewer-overlay'

/** Botão que abre um PDF do próprio app no visualizador interno (com Voltar), no lugar de um link que levava o app inteiro para o PDF. */
export function OpenPdfButton({ url, fallbackName, className, style, children }: { url: string; fallbackName: string; className?: string; style?: CSSProperties; children: ReactNode }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [opened, setOpened] = useState<SignOffFile | null>(null)

  async function open() {
    if (busy) return
    setBusy(true)
    setError(null)
    const result = await fetchPdf({ url, fallbackName })
    setBusy(false)
    if (result.ok) setOpened(result.value)
    else setError(result.message)
  }

  return (
    <>
      <button type="button" onClick={() => void open()} disabled={busy} className={className} style={style}>
        {busy ? 'Preparando o PDF…' : children}
      </button>
      {error && (
        <span role="alert" className="text-xs font-semibold text-red-400">
          {error}{' '}
          <button type="button" onClick={() => void open()} className="underline">
            Tentar novamente
          </button>
        </span>
      )}
      {opened && <PdfViewerOverlay file={opened.file} onClose={() => setOpened(null)} />}
    </>
  )
}
