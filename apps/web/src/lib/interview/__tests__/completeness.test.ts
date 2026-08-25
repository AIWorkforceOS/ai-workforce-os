import { describe, expect, it } from 'vitest'
import { computeTrainingCompleteness, missingProfileFields } from '../completeness'

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
    // profileSchema do traffic_specialist tem 10 campos; 2 preenchidos
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
        estilo_criativo: 'fotos reais da equipe, cores vivas',
        diferencial_para_anuncio: 'atendimento no mesmo dia',
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

describe('missingProfileFields — versão acionável do score, pro Manual de Trabalho (Fase 6)', () => {
  it('retorna lista vazia quando não há agent_configs ou agent_type sem entrevista', () => {
    expect(missingProfileFields(null)).toEqual([])
    expect(missingProfileFields({ agent_type: 'unknown_type', business_profile: {} })).toEqual([])
  })

  it('lista todos os campos humanizados quando o perfil está vazio', () => {
    const missing = missingProfileFields({ agent_type: 'traffic_specialist', business_profile: {} })
    expect(missing).toContain('Tipo negocio')
    expect(missing).toContain('Orcamento mensal brl')
    expect(missing).toHaveLength(10)
  })

  it('some da lista assim que o campo é preenchido — nunca mostra o que já foi ensinado como pendência', () => {
    const missing = missingProfileFields({
      agent_type: 'traffic_specialist',
      business_profile: { tipo_negocio: 'clínica', orcamento_mensal_brl: 5000 },
    })
    expect(missing).not.toContain('Tipo negocio')
    expect(missing).not.toContain('Orcamento mensal brl')
    expect(missing).toContain('Publico alvo')
  })

  it('lista vazia quando 100% preenchido — é o complemento exato de computeTrainingCompleteness', () => {
    const profile = {
      tipo_negocio: 'clínica',
      orcamento_mensal_brl: 5000,
      publico_alvo: 'adultos 25-45',
      regiao: 'São Paulo',
      objetivo_campanha: 'leads',
      cpa_alvo_brl: 50,
      roas_alvo: 3,
      estilo_criativo: 'fotos reais da equipe, cores vivas',
      diferencial_para_anuncio: 'atendimento no mesmo dia',
      observacoes: ['nenhuma'],
    }
    expect(computeTrainingCompleteness({ agent_type: 'traffic_specialist', business_profile: profile })).toBe(100)
    expect(missingProfileFields({ agent_type: 'traffic_specialist', business_profile: profile })).toEqual([])
  })

  it('soma os campos pendentes da vertical quando verticalKey é passado', () => {
    const config = { agent_type: 'receptionist' as const, business_profile: { tipo_negocio: 'limpeza residencial' } }
    const withoutVertical = missingProfileFields(config, null)
    const withVertical = missingProfileFields(config, 'cleaning_services')
    expect(withVertical.length).toBeGreaterThan(withoutVertical.length)
    expect(withVertical).toContain('Pet policy')
  })
})
