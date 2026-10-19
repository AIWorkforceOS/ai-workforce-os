import { createServiceClient } from '@/lib/supabase/service'
import { diagnosisEscalationModel } from './config'
import { createAuditHandler } from './agent/audit'
import { createCostingHandler } from './agent/costing'
import { createLaborHandler } from './agent/labor'
import { createMaterialsHandler } from './agent/materials'
import { SupabasePriceCache } from './agent/price-cache'
import { createPricingHandler } from './agent/pricing'
import { loadActiveRateCard } from './agent/rate-card'
import { OpenAIStructuredModel } from './agent/structured-model'
import { createDiagnosisHandler } from './diagnosis/stage'
import { OpenAIResponsesDiagnosisModel } from './diagnosis/model'
import type { StageHandlers } from './runner'

/** Só fotos do NOSSO Storage (host do Supabase) são baixadas para análise: um job adulterado não vira ferramenta de busca de endereços. */
function allowedPhotoHosts(): string[] {
  try {
    return process.env.NEXT_PUBLIC_SUPABASE_URL ? [new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname] : []
  } catch {
    return []
  }
}

/**
 * Registro das 6 etapas do pipeline. Tudo aqui é leve e preguiçoso (nenhuma rede/banco no import). O módulo só trabalha com a unidade em
 * 'live' (ou 'shadow') e QUOTE_TEAM_ENABLED diferente de 'false'; a pesquisa real de preços só roda com QUOTE_PRICE_SEARCH_ENABLED=true.
 */
const structured = new OpenAIStructuredModel()
export const QUOTE_STAGE_HANDLERS: StageHandlers = {
  diagnosis: createDiagnosisHandler({ model: new OpenAIResponsesDiagnosisModel(), photoDeps: { allowedHosts: allowedPhotoHosts() }, escalationModelName: diagnosisEscalationModel() }),
  materials: createMaterialsHandler({ model: structured }),
  pricing: createPricingHandler({ model: structured, cache: new SupabasePriceCache(() => createServiceClient()) }),
  labor: createLaborHandler({ model: structured }),
  costing: createCostingHandler({
    loadRateCard: async (job) => {
      const db = createServiceClient()
      return db ? loadActiveRateCard(db, job) : null
    },
  }),
  audit: createAuditHandler(),
}
