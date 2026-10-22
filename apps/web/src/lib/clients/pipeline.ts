export type PipelineStage = 'agendada' | 'cotacao' | 'concluida' | 'faturada' | 'recebida'

export const PIPELINE_STAGES: { key: PipelineStage; label: string }[] = [
  { key: 'agendada', label: 'Agendadas' },
  { key: 'cotacao', label: 'Cotação (aguardando aprovação)' },
  { key: 'concluida', label: 'Concluídas · a faturar' },
  { key: 'faturada', label: 'Faturadas' },
  { key: 'recebida', label: 'Recebidas' },
]

export type PipelineInput = {
  serviceOrderStatus: 'pending' | 'completed' | 'quote' | string | null
  invoiceId: string | null
  invoiceStatus: string | null
  paid: boolean
}

/** Em que etapa do funil do cliente a ordem está: cobrança vence a execução, execução vence o agendamento. */
export function stageOf(o: PipelineInput): PipelineStage {
  if (o.paid || o.invoiceStatus === 'paid') return 'recebida'
  if (o.invoiceId) return 'faturada'
  if (o.serviceOrderStatus === 'quote') return 'cotacao'
  if (o.serviceOrderStatus === 'completed') return 'concluida'
  return 'agendada'
}

export function groupByStage<T extends PipelineInput>(items: T[]): Record<PipelineStage, T[]> {
  const out: Record<PipelineStage, T[]> = { agendada: [], cotacao: [], concluida: [], faturada: [], recebida: [] }
  for (const item of items) out[stageOf(item)].push(item)
  return out
}
