import type { StageHandlers } from './runner'

/**
 * Registro das etapas do pipeline. Fase 2: VAZIO de propósito — as etapas reais entram nas Fases 3 a 6
 * (diagnóstico, materiais, pesquisa, mão de obra, custos, auditoria). Enquanto estiver vazio, nenhum job é criado
 * (enqueueQuoteJob recusa com 'pipeline_not_ready') e o fluxo atual da cotação segue exatamente como hoje.
 */
export const QUOTE_STAGE_HANDLERS: StageHandlers = {}
