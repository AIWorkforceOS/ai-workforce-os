import { notFound } from 'next/navigation'
import { PreviewClient } from './preview-client'

/** Pré-visualização SOMENTE DE DESENVOLVIMENTO dos botões Baixar/Compartilhar Sign Off (PDF simulado, nenhum banco). Em produção responde 404. */
export default function SignOffPreviewPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <PreviewClient />
}
