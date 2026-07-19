import { describe, expect, it } from 'vitest'
import { computeTrainingCompleteness } from '../completeness'

describe('computeTrainingCompleteness', () => {
  it('retorna 0 quando não há agent_configs', () => {
    expect(computeTrainingCompleteness(null)).toBe(0)
    expect(computeTrainingCompleteness(undefined)).toBe(0)
  })

  it('retorna 0 quando agent_type não tem entrevista', () => {
    expect(computeTrainingCompleteness({ agent_type: 'unknown_type', business_profile: { x: 1 } })).toBe(0)
  })

  it('retorna 0 quando business_profile está vazio ou nulo', () => {
    expect(computeTrainingCompleteness({ agent_type: 'sdr', business_profile: {} })).toBe(0)
    expect(computeTrainingCompleteness({ agent_type: 'sdr', business_profile: null })).toBe(0)
    expect(computeTrainingCompleteness({ agent_type: 'sdr' })).toBe(0)
  })

  it('conta só os campos com valor não-vazio do profileSchema do playbook', () => {
    const partial = computeTrainingCompleteness({
      agent_type: 'traffic_specialist',
      business_profile: { tipo_negocio: 'clínica', orcamento_mensal_brl: 5000 },
    })
    // profileSchema do traffic_specialist tem 7 campos; 2 preenchidos
    expect(partial).toBeGreaterThan(0)
    expect(partial).toBeLessThan(100)
  })

  it('chega a 100% quando todos os campos do schema estão preenchidos', () => {
    const full = computeTrainingCompleteness({
      agent_type: 'traffic_specialist',
      business_profile: {
        tipo_negocio: 'clínica',
        orcamento_mensal_brl: 5000,
        publico_alvo: 'adultos 25-45',
        regiao: 'São Paulo',
        objetivo_campanha: 'leads',
        cpa_alvo_brl: 50,
        roas_alvo: 3,
        observacoes: ['nenhuma'],
      },
    })
    expect(full).toBe(100)
  })

  it('inclui campos do profileSchemaFragment da vertical quando a org tem vertical_key', () => {
    const withoutVertical = computeTrainingCompleteness(
      {
        agent_type: 'receptionist',
        business_profile: { tipo_negocio: 'limpeza residencial' },
      },
      null,
    )
    const withVertical = computeTrainingCompleteness(
      {
        agent_type: 'receptionist',
        business_profile: { tipo_negocio: 'limpeza residencial' },
      },
      'cleaning_services',
    )
    // Mesmo profile, mas com vertical o denominador de campos esperados cresce
    // (soma o profileSchemaFragment de cleaning_services), então o percentual cai ou mantém.
    expect(withVertical).toBeLessThanOrEqual(withoutVertical)
  })

  it('nunca lança e nunca ultrapassa 0-100 mesmo com profile parcialmente preenchido', () => {
    const score = computeTrainingCompleteness({
      agent_type: 'recruiter',
      business_profile: { sobre_a_empresa: 'agência de RH', segmento: '', cargos_tipicos: [] },
    })
    expect(score).toBeGreaterThanOrEqual(0)
    expect(score).toBeLessThanOrEqual(100)
  })
})
