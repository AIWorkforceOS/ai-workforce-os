/**
 * CÁLCULO COMERCIAL (SOMENTE ADMIN). Função pura e determinística em micro-dólares (inteiros): nenhum valor está no código — tudo
 * vem da regra cadastrada pelo admin (quote_rate_cards). Campo nulo = regra inexistente = nada é aplicado.
 * O técnico nunca recebe nada daqui (tabelas admin-only + RLS + serializadores de lista permitida).
 */
export type RateCardInput = {
  id: string
  billed_hourly_rate: number | null
  technician_hourly_pay: number | null
  min_billable_hours: number | null
  travel_fee_flat: number | null
  travel_fee_hourly: number | null
  materials_markup_pct: number | null
  /** Só `{ "pct": <número> }` é interpretado (imposto percentual); qualquer outro formato NÃO é calculado e vira aviso. */
  tax_rules: unknown
  rounding_rule: 'cent_half_up' | 'cent_up' | 'cent_down' | 'dollar_half_up' | null
}

export type CommercialInput = {
  rateCard: RateCardInput
  manHours: number
  travelHours: number | null
  /** Total de materiais a preço de COMPRA, em micro-dólares (itens sem preço ficam de fora e marcam `partial`). */
  materialsMicros: number
  materialsPartial: boolean
}

export type CommercialResult = {
  rate_card_id: string
  billed_labor_micros: number | null
  internal_labor_cost_micros: number | null
  travel_micros: number | null
  materials_cost_micros: number
  materials_markup_micros: number | null
  taxes_micros: number | null
  commercial_total_micros: number
  margin_micros: number | null
  partial: boolean
  notes: string[]
}

const micros = (usd: number) => Math.round(usd * 1_000_000)

export function roundMicros(value: number, rule: RateCardInput['rounding_rule']): number {
  switch (rule) {
    case 'cent_half_up':
      return Math.round(value / 10_000) * 10_000
    case 'cent_up':
      return Math.ceil(value / 10_000) * 10_000
    case 'cent_down':
      return Math.floor(value / 10_000) * 10_000
    case 'dollar_half_up':
      return Math.round(value / 1_000_000) * 1_000_000
    default:
      return Math.round(value)
  }
}

export function computeCommercial(input: CommercialInput): CommercialResult {
  const { rateCard } = input
  const notes: string[] = []
  const billedRate = rateCard.billed_hourly_rate != null ? micros(rateCard.billed_hourly_rate) : null
  const payRate = rateCard.technician_hourly_pay != null ? micros(rateCard.technician_hourly_pay) : null

  const billableHours = Math.max(input.manHours, rateCard.min_billable_hours ?? 0)
  if (rateCard.min_billable_hours != null && rateCard.min_billable_hours > input.manHours) notes.push(`Hora mínima configurada (${rateCard.min_billable_hours} h) aplicada.`)
  const billedLabor = billedRate != null ? Math.round(billableHours * billedRate) : null
  const internalCost = payRate != null ? Math.round(input.manHours * payRate) : null

  let travel: number | null = null
  if (rateCard.travel_fee_flat != null || (rateCard.travel_fee_hourly != null && input.travelHours != null)) {
    travel = (rateCard.travel_fee_flat != null ? micros(rateCard.travel_fee_flat) : 0) + (rateCard.travel_fee_hourly != null && input.travelHours != null ? Math.round(input.travelHours * micros(rateCard.travel_fee_hourly)) : 0)
  }
  const markup = rateCard.materials_markup_pct != null ? Math.round((input.materialsMicros * rateCard.materials_markup_pct) / 100) : null

  const preTax = (billedLabor ?? 0) + (travel ?? 0) + input.materialsMicros + (markup ?? 0)
  let taxes: number | null = null
  const tax = rateCard.tax_rules as { pct?: unknown } | null
  if (rateCard.tax_rules != null) {
    if (tax && typeof tax.pct === 'number' && Number.isFinite(tax.pct)) taxes = Math.round((preTax * tax.pct) / 100)
    else notes.push('Regra de imposto em formato não reconhecido: imposto NÃO calculado.')
  }
  if (billedRate == null) notes.push('Sem valor/hora cobrado configurado: mão de obra não calculada.')
  const total = roundMicros(preTax + (taxes ?? 0), rateCard.rounding_rule)
  const margin = billedLabor != null && internalCost != null ? Math.round((billedLabor ?? 0) + (travel ?? 0) + (markup ?? 0) - internalCost) : null
  if (input.materialsPartial) notes.push('Materiais com preço pendente: total parcial.')
  return {
    rate_card_id: rateCard.id,
    billed_labor_micros: billedLabor,
    internal_labor_cost_micros: internalCost,
    travel_micros: travel,
    materials_cost_micros: input.materialsMicros,
    materials_markup_micros: markup,
    taxes_micros: taxes,
    commercial_total_micros: total,
    margin_micros: margin,
    partial: input.materialsPartial || billedRate == null,
    notes,
  }
}
