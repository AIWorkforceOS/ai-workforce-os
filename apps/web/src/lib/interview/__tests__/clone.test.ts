import { describe, expect, it } from 'vitest'
import { buildClonedAgentConfig } from '../clone'
import type { AgentConfig } from '@/lib/types'

// Clonar treinamento entre unidades da mesma org (franquias que vendem o
// mesmo produto, só mudando a região) — ver components/dashboard/employee-catalog.tsx.

function makeSdrConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: 'source-id',
    unit_id: 'unit-source',
    agent_type: 'sdr',
    persona_name: 'Victor',
    persona_tone: 'professional',
    daily_limit: 15,
    active_hours: { start: '08:00', end: '18:00', days: [1, 2, 3, 4, 5] },
    escalation_rules: { after_messages: 5, keywords: ['humano'] },
    sectors: ['tecnologia'],
    is_active: true,
    prospecting_profile: { mode: 'business_types', business_types: ['Tecnologia'], region: null },
    business_profile: {
      sobre_a_empresa: 'Gestão de estágios',
      prospeccao: { regioes: ['Rio de Janeiro'], tipos_empresa: ['clínicas'] },
      fechamento: 'fecha_sozinho',
    },
    interview_status: 'completed',
    interview_transcript: [{ role: 'assistant', content: 'oi' }],
    training_corrections: [],
    last_trained_at: '2026-07-20T00:00:00.000Z',
    created_at: '2026-07-01T00:00:00.000Z',
    updated_at: '2026-07-20T00:00:00.000Z',
    ...overrides,
  }
}

describe('buildClonedAgentConfig — clonar treinamento entre unidades', () => {
  it('sdr: substitui prospeccao.regioes e prospecting_profile.region pela nova região, preservando o resto do perfil', () => {
    const source = makeSdrConfig()
    const result = buildClonedAgentConfig({ source, region: 'Belo Horizonte', now: new Date('2026-07-29T12:00:00.000Z') })

    expect(result.business_profile.sobre_a_empresa).toBe('Gestão de estágios')
    expect(result.business_profile.fechamento).toBe('fecha_sozinho')
    expect((result.business_profile.prospeccao as { regioes: string[]; tipos_empresa: string[] }).regioes).toEqual(['Belo Horizonte'])
    expect((result.business_profile.prospeccao as { tipos_empresa: string[] }).tipos_empresa).toEqual(['clínicas'])
    expect(result.prospecting_profile.region).toBe('Belo Horizonte')
    expect(result.prospecting_profile.business_types).toEqual(['Tecnologia'])
    expect(result.interview_status).toBe('completed')
    expect(result.last_trained_at).toBe('2026-07-29T12:00:00.000Z')
  })

  it('região em branco não sobrescreve o campo — clona o resto do perfil intacto', () => {
    const source = makeSdrConfig()
    const result = buildClonedAgentConfig({ source, region: '   ' })
    expect((result.business_profile.prospeccao as { regioes: string[] }).regioes).toEqual(['Rio de Janeiro'])
    expect(result.prospecting_profile.region).toBeNull()
  })

  it('traffic_specialist: região vai para business_profile.regiao', () => {
    const source = makeSdrConfig({
      agent_type: 'traffic_specialist',
      business_profile: { tipo_negocio: 'estágios', orcamento_mensal_brl: 3000, regiao: 'Rio de Janeiro' },
    })
    const result = buildClonedAgentConfig({ source, region: 'Curitiba' })
    expect(result.business_profile.regiao).toBe('Curitiba')
    expect(result.business_profile.tipo_negocio).toBe('estágios')
  })

  it('seo_specialist: região vai para business_profile.regiao_atuacao', () => {
    const source = makeSdrConfig({ agent_type: 'seo_specialist', business_profile: { site_url: 'https://x.com' } })
    const result = buildClonedAgentConfig({ source, region: 'Todo o Brasil' })
    expect(result.business_profile.regiao_atuacao).toBe('Todo o Brasil')
  })

  it('receptionist: sem campo de região no schema — clona sem alterar nada além dos metadados', () => {
    const source = makeSdrConfig({ agent_type: 'receptionist', business_profile: { tipo_negocio: 'clínica' } })
    const result = buildClonedAgentConfig({ source, region: 'Salvador' })
    expect(result.business_profile).toEqual({ tipo_negocio: 'clínica' })
  })

  it('sempre marca interview_status completed e copia transcript/correções pra auditoria', () => {
    const source = makeSdrConfig()
    const result = buildClonedAgentConfig({ source, region: 'Recife' })
    expect(result.interview_status).toBe('completed')
    expect(result.interview_transcript).toEqual(source.interview_transcript)
    expect(result.training_corrections).toEqual(source.training_corrections)
  })
})
