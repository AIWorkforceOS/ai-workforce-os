import { NO_CLIENT_LABEL } from '@/lib/billing/by-client'
import { stageOf, type PipelineInput, type PipelineStage } from './pipeline'

export type OverviewOrder = PipelineInput & { clientName: string }

export type ClientOverview = {
  name: string
  total: number
  stages: Record<PipelineStage, number>
  /** Cotações aguardando decisão do cliente — o que mais pede ação do administrador. */
  awaitingApproval: number
  registered: boolean
}

const emptyStages = (): Record<PipelineStage, number> => ({ agendada: 0, cotacao: 0, aprovada: 0, concluida: 0, faturada: 0, recebida: 0 })

/**
 * Índice de clientes: um cartão por cliente com a contagem de ordens em cada etapa do funil. Inclui clientes cadastrados mesmo sem ordens
 * e deixa de fora ordens sem cliente vinculado (essas aparecem num aviso à parte). Ordenado por quem tem mais cotações aguardando, depois por nome.
 */
export function buildClientOverview(registeredNames: string[], orders: OverviewOrder[]): { clients: ClientOverview[]; unlinked: number } {
  const byKey = new Map<string, ClientOverview>()
  const key = (n: string) => n.trim().replace(/\s+/g, ' ').toLowerCase()
  for (const name of registeredNames) {
    const k = key(name)
    if (k && !byKey.has(k)) byKey.set(k, { name: name.trim().replace(/\s+/g, ' '), total: 0, stages: emptyStages(), awaitingApproval: 0, registered: true })
  }
  let unlinked = 0
  for (const o of orders) {
    if (!o.clientName || o.clientName === NO_CLIENT_LABEL) {
      unlinked += 1
      continue
    }
    const k = key(o.clientName)
    let c = byKey.get(k)
    if (!c) {
      c = { name: o.clientName.trim().replace(/\s+/g, ' '), total: 0, stages: emptyStages(), awaitingApproval: 0, registered: false }
      byKey.set(k, c)
    }
    const stage = stageOf(o)
    c.total += 1
    c.stages[stage] += 1
    if (stage === 'cotacao' && o.quoteDecision !== 'rejected') c.awaitingApproval += 1
  }
  const clients = [...byKey.values()].sort((a, b) => b.awaitingApproval - a.awaitingApproval || a.name.localeCompare(b.name, 'pt-BR'))
  return { clients, unlinked }
}
