'use client'

import { useEffect, useMemo } from 'react'
import { ArrowLeft, Download, Share2 } from 'lucide-react'
import { canShareFiles, downloadPdf, sharePdf } from '@/lib/portal-funcionario/signoff-download'
import { PdfPagesView } from './pdf-pages-view'

/**
 * Visualizador de PDF DENTRO do app, com botão grande de voltar. No app instalado (sem barra do navegador) abrir o PDF numa nova tela
 * deixava a pessoa presa sem como voltar: aqui o app nunca sai da página. O botão voltar do celular (Android) e a tecla Esc também fecham.
 */
export function PdfViewerOverlay({ file, onClose, title }: { file: File; onClose: () => void; title?: string }) {
  const url = useMemo(() => URL.createObjectURL(file), [file])
  const canShare = useMemo(() => canShareFiles(), [])

  useEffect(() => () => URL.revokeObjectURL(url), [url])
  useEffect(() => {
    // o botão voltar do celular fecha o visualizador em vez de sair do app
    history.pushState({ pdfViewer: true }, '')
    const onPop = () => onClose()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('popstate', onPop)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('popstate', onPop)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  function close() {
    if (history.state?.pdfViewer) history.back() // dispara o popstate acima, que fecha
    else onClose()
  }

  return (
    <div className="fixed inset-0 z-[200] flex flex-col" style={{ background: '#0a0f1e' }} role="dialog" aria-modal="true" aria-label={title ?? 'PDF'}>
      <div className="flex items-center justify-between gap-2 px-3 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}>
        <button type="button" onClick={close} className="flex shrink-0 items-center gap-1.5 rounded-xl px-4 py-3 text-base font-bold text-white active:scale-[0.98]" style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)' }}>
          <ArrowLeft size={18} />
          Voltar
        </button>
        <p className="hidden min-w-0 flex-1 truncate text-xs font-semibold text-slate-300 sm:block">{title ?? file.name}</p>
        <button type="button" onClick={() => void (canShare ? sharePdf(file) : Promise.resolve(downloadPdf(file)))} className="flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-3 text-sm font-bold text-slate-100" style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)' }} aria-label={canShare ? 'Compartilhar ou salvar' : 'Baixar'}>
          {canShare ? <Share2 size={16} /> : <Download size={16} />}
          {canShare ? 'Salvar/Enviar' : 'Baixar'}
        </button>
      </div>
      <PdfPagesView file={file} fallbackUrl={url} />
    </div>
  )
}
