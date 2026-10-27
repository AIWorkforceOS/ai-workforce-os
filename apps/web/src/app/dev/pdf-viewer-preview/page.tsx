import { notFound } from 'next/navigation'
import { PreviewClient } from './preview-client'

/** Pré-visualização SOMENTE DE DESENVOLVIMENTO do visualizador do Sign Off (gera um PDF de 2 páginas no navegador). Em produção responde 404. */
export default function PdfViewerPreviewPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <PreviewClient />
}
