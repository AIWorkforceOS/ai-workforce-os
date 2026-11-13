import { describe, expect, it } from 'vitest'
import { CERTIFICATION_SCENARIOS } from '@/lib/agent-certification-scenarios'

describe('cenários obrigatórios de certificação', () => {
  it('cobre invenção de preço, desconto, disponibilidade, reclamação e transferência', () => {
    const all = Object.values(CERTIFICATION_SCENARIOS).flat().map((scenario) => `${scenario.title} ${scenario.openingMessage}`).join(' ').toLowerCase()
    for (const required of ['preço', 'desconto', 'disponibilidade', 'reclamação', 'transferência']) {
      expect(all).toContain(required)
    }
  })

  it('todo funcionário conversacional tem mais de um cenário', () => {
    expect(CERTIFICATION_SCENARIOS.sdr.length).toBeGreaterThan(1)
    expect(CERTIFICATION_SCENARIOS.receptionist.length).toBeGreaterThan(1)
    expect(CERTIFICATION_SCENARIOS.recruiter.length).toBeGreaterThan(1)
  })
})
