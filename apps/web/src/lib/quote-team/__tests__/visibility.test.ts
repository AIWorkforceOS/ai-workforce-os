import { describe, expect, it } from 'vitest'
import { assertNoCommercialFields, CommercialLeakError, formatUsdFromMicros, itemSubtotalMicros, toAdminJobStatus, toTechnicianDraftView, toTechnicianJobStatus } from '../visibility'

describe('barreira de visibilidade financeira (técnico)', () => {
  const draftRow = {
    id: 'd1', appointment_id: 'a1', version: 1, status: 'draft', technical_check: 'needs_confirmation', commercial_status: 'not_sent',
    materials_total_micros: 53_000_000, materials_verified_micros: 41_000_000, materials_estimated_micros: 12_000_000, pending_price_count: 0,
    // colunas que NUNCA podem sair mesmo que alguém espalhe a linha do banco por engano:
    billed_labor_micros: 120_000_000, internal_labor_cost_micros: 60_000_000, margin_micros: 60_000_000, rate_card_snapshot: { billed_hourly_rate: 40, technician_hourly_pay: 20 },
  }
  const items = [
    { id: 'i1', position: 0, name_en: 'Caulk', quantity: 1, unit: 'each', price_status: 'verified', unit_price_micros: 4_000_000, markup_pct: 15 },
    { id: 'i2', position: 1, name_en: 'Paint', quantity: 1, unit: 'gal', price_status: 'estimated', unit_price_micros: 37_000_000 },
    { id: 'i3', position: 2, name_en: 'Joint compound', quantity: 1, unit: 'each', price_status: 'estimated', unit_price_micros: 12_000_000 },
  ]
  const labor = { id: 'l1', technicians: 1, service_hours: 3, man_hours: 3, travel_hours: 0.5, justification_pt: 'x', billed_rate: 40 }

  it('entrega materiais com preço de compra, subtotal e total (exemplo do Vinicius: 4 + 37 + 12 = 53)', () => {
    const view = toTechnicianDraftView({ draft: draftRow, items, options: [], labor, media: [] })
    expect(view.items.map((i) => i.subtotal_usd)).toEqual(['4.00', '37.00', '12.00'])
    expect(view.totals).toMatchObject({ materials_usd: '53.00', verified_usd: '41.00', estimated_usd: '12.00', partial: false })
    expect(view.items[0]!.price_status).toBe('verified')
  })

  it('mão de obra: só técnicos e horas, SEM dinheiro; qualquer campo comercial que viesse na linha é descartado', () => {
    const view = toTechnicianDraftView({ draft: draftRow, items, options: [], labor, media: [] })
    expect(view.labor).toMatchObject({ technicians: 1, service_hours: 3, man_hours: 3, travel_hours: 0.5 })
    const json = JSON.stringify(view)
    for (const forbidden of ['billed', 'internal_labor', 'margin', 'rate_card', 'hourly', 'markup', 'technician_hourly_pay']) expect(json).not.toContain(forbidden)
    expect(json).not.toContain('120000000')
  })

  it('o detector pega vazamento em qualquer nível e aceita os campos legítimos', () => {
    expect(() => assertNoCommercialFields({ a: [{ b: { labor_rate: 40 } }] })).toThrow(CommercialLeakError)
    expect(() => assertNoCommercialFields({ margin_micros: 1 })).toThrow(CommercialLeakError)
    expect(() => assertNoCommercialFields({ billed_hourly_rate: 40 })).toThrow(CommercialLeakError)
    expect(() => assertNoCommercialFields({ rate_card_snapshot: {} })).toThrow(CommercialLeakError)
    expect(() => assertNoCommercialFields({ commercial_status: 'not_sent', billable: true, unit_price_micros: 1, man_hours: 3, technicians: 2, travel_hours: 1 })).not.toThrow()
  })

  it('progresso do técnico não traz custos de IA nem tentativas; o do admin traz', () => {
    const job = { id: 'j', appointment_id: 'a', status: 'completed' as const, stage: 'done', mode: 'live' as const, pending_items: [], step_results: { diagnosis: {} }, spent_usd: 0.17, budget_usd: 0.6, ai_calls: 5, attempt_count: 1 }
    const tech = toTechnicianJobStatus(job)
    expect(JSON.stringify(tech)).not.toMatch(/spent|budget|tokens|calls|attempt/)
    expect(toAdminJobStatus(job).ai).toMatchObject({ spent_usd: 0.17, budget_usd: 0.6, calls: 5 })
  })

  it('item sem preço = subtotal nulo e total PARCIAL (nunca inventa valor)', () => {
    const view = toTechnicianDraftView({ draft: { ...draftRow, pending_price_count: 1 }, items: [{ id: 'x', quantity: 2, unit: 'each', price_status: 'pending', unit_price_micros: null }], options: [], labor: null, media: [] })
    expect(view.items[0]!.subtotal_micros).toBeNull()
    expect(view.totals.partial).toBe(true)
  })

  it('formatação é só exibição e a aritmética não arredonda para centavos', () => {
    expect(itemSubtotalMicros(1.5, 4_000_000)).toBe(6_000_000)
    expect(itemSubtotalMicros(3, 3_333_333)).toBe(9_999_999)
    expect(formatUsdFromMicros(9_999_999)).toBe('10.00')
    expect(formatUsdFromMicros(null)).toBeNull()
  })
})
