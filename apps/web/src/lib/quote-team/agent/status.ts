import type { JobStatus } from '../contracts'

/** Rótulos de andamento mostrados ao técnico (sem custos, sem detalhes internos). */
export function technicianStatusLabel(job: { status: JobStatus; stage: string } | null, draft: { status: string } | null): { code: string; label: string } {
  if (!job) return { code: 'not_started', label: 'Pronta para gerar a cotação com IA' }
  switch (job.status) {
    case 'queued':
      return { code: 'preparing', label: 'Preparando análise' }
    case 'running':
      if (job.stage === 'diagnosis') return { code: 'analyzing_photos', label: 'Analisando fotografias' }
      if (job.stage === 'materials') return { code: 'identifying_materials', label: 'Identificando materiais' }
      if (job.stage === 'pricing') return { code: 'searching_products', label: 'Pesquisando produtos' }
      return { code: 'calculating_labor', label: 'Calculando mão de obra' }
    case 'needs_input':
      return { code: 'awaiting_information', label: 'Aguardando informações' }
    case 'completed':
      return draft?.status === 'approved' ? { code: 'approved', label: 'Cotação técnica aprovada' } : { code: 'awaiting_technician_review', label: 'Aguardando revisão do técnico' }
    case 'budget_exhausted':
      return draft?.status === 'approved' ? { code: 'approved', label: 'Cotação técnica aprovada' } : { code: 'budget_exhausted', label: 'Orçamento de IA da cotação esgotado — continue manualmente' }
    case 'failed':
      return { code: 'recoverable_failure', label: 'Falha recuperável — tente novamente' }
    case 'cancelled':
    default:
      return { code: 'cancelled', label: 'Análise cancelada' }
  }
}
