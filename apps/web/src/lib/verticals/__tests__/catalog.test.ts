import { describe, expect, it } from 'vitest'
import { VERTICAL_TEMPLATES, isVerticalKey, type VerticalKey } from '../catalog'

// Cobre os 6 verticais novos adicionados em 19/08/2026 (auditoria P0.4):
// dental_clinic, medical_clinic, vocational_education, hr_company,
// internship_agency, restaurant_food_service. Garante que cada um segue
// exatamente o mesmo contrato dos verticais já em produção — nada aqui
// testa conteúdo específico (isso é edição de texto, não lógica), só a
// integridade estrutural que o resto do sistema (interview engine,
// dashboard, wizard) depende para funcionar sem quebrar.

const NEW_VERTICALS: VerticalKey[] = [
  'dental_clinic',
  'medical_clinic',
  'vocational_education',
  'hr_company',
  'internship_agency',
  'restaurant_food_service',
]

const EXISTING_VERTICALS: VerticalKey[] = ['cleaning_services', 'therapy_clinic', 'general_maintenance']

const TERMINOLOGY_KEYS = ['customer', 'appointment', 'staff', 'deal'] as const

describe('VERTICAL_TEMPLATES — 6 novos verticais (19/08/2026)', () => {
  it('isVerticalKey reconhece todos os 6 novos + continua reconhecendo os antigos e "other"', () => {
    for (const key of [...NEW_VERTICALS, ...EXISTING_VERTICALS, 'other']) {
      expect(isVerticalKey(key)).toBe(true)
    }
    expect(isVerticalKey('nonexistent_vertical')).toBe(false)
  })

  it.each(NEW_VERTICALS)('%s: terminologia cobre os 4 campos lidos por getTerminology (customer/appointment/staff/deal), pt e en', (key) => {
    const template = VERTICAL_TEMPLATES[key]
    for (const termKey of TERMINOLOGY_KEYS) {
      expect(template.terminology[termKey]?.pt).toBeTruthy()
      expect(template.terminology[termKey]?.en).toBeTruthy()
    }
  })

  it.each(NEW_VERTICALS)('%s: labelPt/labelEn preenchidos (aparecem no menu de opções da entrevista)', (key) => {
    const template = VERTICAL_TEMPLATES[key]
    expect(template.labelPt.length).toBeGreaterThan(0)
    expect(template.labelEn.length).toBeGreaterThan(0)
  })

  it.each(NEW_VERTICALS)('%s: tem customerFieldSchema não-vazio com keys únicas', (key) => {
    const fields = VERTICAL_TEMPLATES[key].customerFieldSchema
    expect(fields.length).toBeGreaterThan(0)
    const keys = fields.map((f) => f.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it.each(NEW_VERTICALS)('%s: tem dashboardKpis não-vazio', (key) => {
    expect(VERTICAL_TEMPLATES[key].dashboardKpis.length).toBeGreaterThan(0)
  })

  it.each(NEW_VERTICALS)('%s: tem ao menos um testScenario com título e mensagem de abertura', (key) => {
    const scenarios = VERTICAL_TEMPLATES[key].testScenarios ?? []
    expect(scenarios.length).toBeGreaterThan(0)
    for (const s of scenarios) {
      expect(s.title.length).toBeGreaterThan(0)
      expect(s.openingMessage.length).toBeGreaterThan(0)
    }
  })

  it.each(NEW_VERTICALS)('%s: interviewExtra (quando presente) só usa tipos de entrevista válidos (sdr/receptionist/recruiter)', (key) => {
    const extra = VERTICAL_TEMPLATES[key].interviewExtra ?? {}
    for (const agentType of Object.keys(extra)) {
      expect(['sdr', 'recruiter', 'receptionist']).toContain(agentType)
    }
  })

  it('hr_company e internship_agency (únicos verticais B2B de RH) incluem interviewExtra.recruiter', () => {
    expect(VERTICAL_TEMPLATES.hr_company.interviewExtra?.recruiter).toBeTruthy()
    expect(VERTICAL_TEMPLATES.internship_agency.interviewExtra?.recruiter).toBeTruthy()
  })

  it('total de verticais no catálogo é 10 (3 originais + 6 novos + "other")', () => {
    expect(Object.keys(VERTICAL_TEMPLATES)).toHaveLength(10)
  })
})
