import { describe, expect, it } from 'vitest'
import { auditQuote } from '../audit'
import { diagnosisFixture, materialsFixture } from './helpers'

const full = {
  diagnosis: { diagnosis: diagnosisFixture() },
  materials: { items: materialsFixture([{}]).items, warnings: [] },
  pricing: { enabled: true, searches: 1, cost_usd: 0, items: [{ index: 0, name_en: 'x', status: 'verified', reason: null, options: [], selected: 0, checked_at: '' }] },
  labor: { labor: { technicians: 1, service_hours: 1, multi_technician_justification: null }, man_hours: 1, warnings: [] },
}

describe('auditQuote', () => {
  it('tudo coerente e verificado ⇒ ready_for_review', () => {
    expect(auditQuote(full).status).toBe('ready_for_review')
  })
  it('preço pendente / item a confirmar / confiança baixa ⇒ needs_confirmation', () => {
    expect(auditQuote({ ...full, pricing: { ...full.pricing, items: [{ ...full.pricing.items[0]!, status: 'pending' }] } }).status).toBe('needs_confirmation')
    expect(auditQuote({ ...full, diagnosis: { diagnosis: diagnosisFixture({ visual_confidence: 'low' }) } }).status).toBe('needs_confirmation')
  })
  it('sem diagnóstico ⇒ blocked; mais de um técnico sem justificativa ⇒ blocked', () => {
    expect(auditQuote({ ...full, diagnosis: undefined }).status).toBe('blocked')
    expect(auditQuote({ ...full, labor: { ...full.labor, labor: { technicians: 2, service_hours: 1, multi_technician_justification: null } } }).status).toBe('blocked')
  })
  it('sem fotos analisadas avisa que não há diagnóstico visual', () => {
    const r = auditQuote({ ...full, diagnosis: { diagnosis: diagnosisFixture({ photos_analyzed: 0, visual_confidence: 'none', evidence: [], insufficient_photos: true }) } })
    expect(r.findings.map((f) => f.rule)).toContain('no_visual_diagnosis')
  })
})
