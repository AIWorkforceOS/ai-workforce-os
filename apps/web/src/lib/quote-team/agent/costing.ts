import type { StageHandler } from '../runner'
import { computeCommercial, type CommercialResult, type RateCardInput } from './commercial'
import type { LaborStageResult } from './labor'
import type { PricingStageResult } from './pricing'
import type { MaterialsStageResult } from './materials'

export type CostingStageResult = { skipped: 'no_rate_card' | 'no_labor' } | { skipped?: undefined; rate_card: RateCardInput; commercial: CommercialResult }

/** Subtotais de materiais a preço de COMPRA (só itens com preço verificado). */
export function materialsTotalFromPricing(materials: MaterialsStageResult | undefined, pricing: PricingStageResult | undefined): { micros: number; partial: boolean } {
  const items = materials?.items ?? []
  let total = 0
  let partial = false
  items.forEach((item, index) => {
    if (item.kind === 'tool') return
    const priced = pricing?.items.find((p) => p.index === index)
    const option = priced && priced.selected !== null ? priced.options[priced.selected] : null
    if (option && option.price != null) total += Math.round(item.quantity * Math.round(option.price * 1_000_000))
    else partial = true
  })
  return { micros: total, partial }
}

/** Etapa 5 — custos (SEM IA, SOMENTE ADMIN). A regra comercial é carregada pelo servidor (nunca vai a nenhum modelo). */
export function createCostingHandler(deps: { loadRateCard: (job: { org_id: string; unit_id: string }) => Promise<RateCardInput | null> }): StageHandler {
  return {
    needsAi: false,
    async run(ctx) {
      const labor = ctx.stepResults.labor as LaborStageResult | { skipped: string } | undefined
      if (!labor || !('labor' in labor)) return { kind: 'done', result: { skipped: 'no_labor' } satisfies CostingStageResult }
      const rateCard = await deps.loadRateCard({ org_id: ctx.job.org_id, unit_id: ctx.job.unit_id })
      if (!rateCard) return { kind: 'done', result: { skipped: 'no_rate_card' } satisfies CostingStageResult }
      const totals = materialsTotalFromPricing(ctx.stepResults.materials as MaterialsStageResult | undefined, ctx.stepResults.pricing as PricingStageResult | undefined)
      const commercial = computeCommercial({ rateCard, manHours: labor.man_hours, travelHours: labor.labor.travel_hours ?? null, materialsMicros: totals.micros, materialsPartial: totals.partial })
      return { kind: 'done', result: { rate_card: rateCard, commercial } satisfies CostingStageResult }
    },
  }
}
