import { describe, expect, it } from 'vitest'
import { diagnosisSchema, laborSchema, manHours, materialItemSchema, productOptionSchema } from '../contracts'
import { effectiveQuoteTeamMode, isQuoteTeamKillSwitchOn } from '../config'

const diag = { summary_pt: 's', problem_en: 'p', evidence: [], hypotheses: [], identified: { brand: null, model: null, part_numbers: [], labels_read: [] }, additional_info_needed: [], safety_risks: [], scope_pt: 'e', scope_en: 'e', photos_analyzed: 0, visual_confidence: 'none' as const, insufficient_photos: true }

describe('contratos', () => {
  it('sem foto analisada NÃO pode haver diagnóstico visual nem evidência visual', () => {
    expect(diagnosisSchema.safeParse(diag).success).toBe(true)
    expect(diagnosisSchema.safeParse({ ...diag, visual_confidence: 'high' }).success).toBe(false)
    expect(diagnosisSchema.safeParse({ ...diag, evidence: [{ fact: 'porta torta', photo_refs: [0], confidence: 'high' }] }).success).toBe(false)
  })
  it('evidência só pode apontar para foto realmente analisada', () => {
    const withPhotos = { ...diag, photos_analyzed: 2, visual_confidence: 'medium' as const }
    expect(diagnosisSchema.safeParse({ ...withPhotos, evidence: [{ fact: 'x', photo_refs: [1], confidence: 'medium' }] }).success).toBe(true)
    expect(diagnosisSchema.safeParse({ ...withPhotos, evidence: [{ fact: 'x', photo_refs: [2], confidence: 'medium' }] }).success).toBe(false)
  })
  it('material: part number é opcional (nunca obrigatório → nunca inventado); desperdício exige justificativa', () => {
    const item = { kind: 'material', necessity: 'required', name_en: 'Door closer', description_pt: 'Fechamento', quantity: 1, unit: 'each', reason: 'r', confidence: 'medium' }
    expect(materialItemSchema.safeParse(item).success).toBe(true)
    expect(materialItemSchema.safeParse({ ...item, waste_pct: 10 }).success).toBe(false)
    expect(materialItemSchema.safeParse({ ...item, waste_pct: 10, waste_justification: 'cortes de baseboard' }).success).toBe(true)
  })
  it('2+ técnicos só com justificativa; horas-homem = técnicos × horas, calculadas em código', () => {
    const labor = { technicians: 2, service_hours: 2, justification_pt: 'j', description_en: 'd', breakdown: [] }
    expect(laborSchema.safeParse(labor).success).toBe(false)
    expect(laborSchema.safeParse({ ...labor, multi_technician_justification: 'peso da porta' }).success).toBe(true)
    expect(manHours(2, 2)).toBe(4)
    expect(manHours(1, 1.5)).toBe(1.5)
  })
  it('produto: só https e preço só com citação válida', () => {
    const opt = { supplier: 'Home Depot', product_url: 'https://www.homedepot.com/p/x/123', title: 't', brand: null, model: null, sku: null, price: 78.4, currency: 'USD', citation: { url: 'https://www.homedepot.com/p/x/123', snippet: '$78.40' }, match_score: 0.9 }
    expect(productOptionSchema.safeParse(opt).success).toBe(true)
    expect(productOptionSchema.safeParse({ ...opt, product_url: 'http://x.com/p' }).success).toBe(false)
  })
})

describe('interruptores', () => {
  it('kill switch global vence a chave da unidade', () => {
    expect(isQuoteTeamKillSwitchOn({ QUOTE_TEAM_ENABLED: 'false' })).toBe(true)
    expect(effectiveQuoteTeamMode('live', { QUOTE_TEAM_ENABLED: 'false' })).toBe('off')
    expect(effectiveQuoteTeamMode('shadow', {})).toBe('shadow')
    expect(effectiveQuoteTeamMode('qualquer-coisa', {})).toBe('off')
    expect(effectiveQuoteTeamMode(null, {})).toBe('off')
  })
})
