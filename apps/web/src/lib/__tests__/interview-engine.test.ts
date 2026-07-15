import { describe, expect, it } from 'vitest'
import {
  FINAL_QUESTION,
  INTERVIEW_PLAYBOOKS,
  buildBusinessContext,
  buildInterviewerPrompt,
  isInterviewAgentType,
} from '@/lib/interview/engine'
import { buildSystemPrompt } from '@/lib/conversation-engine'
import { buildRecruiterBasePrompt } from '@/lib/recruiter/prompts'
import { strategyFromBusinessProfile } from '@/lib/traffic/strategy-engine'
import type { AgentConfig, Unit } from '@/lib/types'

// Integração da entrevista de contratação com o trabalho real dos 3
// funcionários: roteiros por cargo e consumo do business_profile nos
// prompts/estratégia. O contrato do motor em si (reduceInterview,
// mergeProfile) é testado em lib/interview/__tests__/engine.test.ts.

const unit = { name: 'Unidade Teste', region_city: 'Campinas' } as Unit

function makeConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: 'cfg-1',
    unit_id: 'unit-1',
    agent_type: 'sdr',
    persona_name: 'Kai',
    persona_tone: 'friendly',
    daily_limit: 15,
    active_hours: { start: '08:00', end: '18:00', days: [1, 2, 3, 4, 5] },
    escalation_rules: { after_messages: 5, keywords: [] },
    sectors: [],
    is_active: false,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

describe('roteiros por funcionário', () => {
  it('há roteiro pros 3 funcionários e todos exigem o encerramento com a pergunta final', () => {
    for (const type of ['sdr', 'recruiter', 'traffic_specialist'] as const) {
      expect(isInterviewAgentType(type)).toBe(true)
      const prompt = buildInterviewerPrompt({
        config: makeConfig({ agent_type: type }),
        unit,
        profile: {},
        finalAlreadyAsked: false,
      })
      expect(prompt).toContain(FINAL_QUESTION)
      expect(prompt).toContain('TÓPICOS OBRIGATÓRIOS')
      for (const topic of INTERVIEW_PLAYBOOKS[type].requiredTopics) {
        expect(prompt).toContain(topic)
      }
    }
    expect(isInterviewAgentType('support')).toBe(false)
  })

  it('o roteiro do SDR cobre o escopo pedido pelo produto', () => {
    const topics = INTERVIEW_PLAYBOOKS.sdr.requiredTopics.join(' ')
    expect(topics).toMatch(/preço/)
    expect(topics).toMatch(/desconto/)
    expect(topics).toMatch(/B2B/)
    expect(topics).toMatch(/Google Maps/)
    expect(topics).toMatch(/fechamento/)
  })
})

describe('consumo do business_profile no trabalho real', () => {
  const profile = {
    produtos: [{ nome: 'Plano Pro', preco: 'R$ 997/mês' }],
    politica_desconto: 'até 15% pra fechar no ato',
    fechamento: 'fecha_sozinho',
  }

  it('buildSystemPrompt do SDR inclui a ficha da empresa e ajusta o objetivo', () => {
    const prompt = buildSystemPrompt(makeConfig({ business_profile: profile }), unit)
    expect(prompt).toContain('FICHA DA EMPRESA')
    expect(prompt).toContain('R$ 997/mês')
    expect(prompt).toContain('até 15% pra fechar no ato')
    expect(prompt).toContain('conduzir a venda até o fechamento')
  })

  it('sem entrevista, os prompts continuam como antes (sem ficha)', () => {
    const prompt = buildSystemPrompt(makeConfig(), unit)
    expect(prompt).not.toContain('FICHA DA EMPRESA')
    expect(prompt).toContain('agendar uma conversa com um vendedor humano')
    expect(buildBusinessContext({})).toBeNull()
    expect(buildBusinessContext(null)).toBeNull()
  })

  it('buildRecruiterBasePrompt inclui a ficha da empresa', () => {
    const prompt = buildRecruiterBasePrompt(
      makeConfig({ agent_type: 'recruiter', business_profile: { segmento: 'estágios em TI' } }),
      unit,
    )
    expect(prompt).toContain('FICHA DA EMPRESA')
    expect(prompt).toContain('estágios em TI')
  })

  it('strategyFromBusinessProfile deriva alvos do Gestor de Tráfego', () => {
    expect(
      strategyFromBusinessProfile({ orcamento_mensal_brl: 3000, cpa_alvo_brl: 50, roas_alvo: 3 }),
    ).toEqual({ max_daily_budget_cents: 10000, target_cpa_cents: 5000, target_roas: 3 })
    expect(strategyFromBusinessProfile({ orcamento_mensal_brl: 'abc', roas_alvo: -1 })).toEqual({})
    expect(strategyFromBusinessProfile(null)).toEqual({})
  })
})
