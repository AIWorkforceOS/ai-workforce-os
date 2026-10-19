import { notFound } from 'next/navigation'
import { PreviewClient } from './preview-client'

/** Pré-visualização SOMENTE DE DESENVOLVIMENTO da tela do técnico (respostas simuladas, nenhum banco/IA). Em produção responde 404. */
export default function QuoteAgentPreviewPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <PreviewClient />
}
