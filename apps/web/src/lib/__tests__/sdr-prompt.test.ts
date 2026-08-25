// Testes de conteúdo do prompt do SDR (buildSystemPrompt) — buildSystemPrompt
// já é exercitado indiretamente em agent-identity.test.ts (regras de
// identidade) e conversation-engine tinha 0 teste direto do uso real da
// ficha do negócio/fechamento, mesma lacuna encontrada no Receptionist.
import { describe, expect, it } from 'vitest'
import { buildSystemPrompt } from '../conversation-engine'
import type { AgentConfig, Unit } from '../types'

const unit = { name: 'Padaria Estrela', region_city: 'Curitiba' } as Unit

function baseConfig(businessProfile: Record<string, unknown> = {}): AgentConfig {
  return {
    persona_name: 'Léo',
    persona_tone: 'friendly',
    daily_limit: 15,
    active_hours: { start: '08:00', end: '18:00', days: [1, 2, 3, 4, 5] },
    business_profile: businessProfile,
  } as AgentConfig
}

describe('buildSystemPrompt (SDR)', () => {
  it('inclui a ficha do negócio quando existe business_profile', () => {
    const prompt = buildSystemPrompt(baseConfig({ sobre_a_empresa: 'padaria artesanal de bairro' }), unit)
    expect(prompt).toContain('padaria artesanal de bairro')
  })

  it('funde a ficha compartilhada da organização com a do agente', () => {
    const prompt = buildSystemPrompt(baseConfig({ sobre_a_empresa: 'padaria artesanal' }), unit, undefined, {
      org_company_name: 'Padaria Estrela',
    })
    expect(prompt).toContain('Padaria Estrela')
    expect(prompt).toContain('padaria artesanal')
  })

  it('quando fecha sozinho, lista só os campos ensinados pela empresa — nunca um padrão fixo', () => {
    const prompt = buildSystemPrompt(
      baseConfig({
        fechamento: 'fecha_sozinho',
        fechamento_campos: [{ chave: 'cidade', pergunta: 'Qual sua cidade?' }],
      }),
      unit,
    )
    expect(prompt).toContain('Qual sua cidade?')
  })

  it('quando não fecha sozinho, não inclui a seção de coleta de dados de fechamento', () => {
    const prompt = buildSystemPrompt(baseConfig({ fechamento: 'qualifica_e_passa_para_humano' }), unit)
    expect(prompt).not.toContain('FECHAMENTO DE NEGÓCIO')
  })

  it('sem biblioteca de materiais configurada, aplica a regra de nunca inventar anexo', () => {
    const prompt = buildSystemPrompt(baseConfig(), unit)
    expect(prompt).toContain('NUNCA')
  })

  it('avisa o que já foi coletado do fechamento em andamento e o que falta perguntar', () => {
    const prompt = buildSystemPrompt(
      baseConfig({
        fechamento: 'fecha_sozinho',
        fechamento_campos: [
          { chave: 'cidade', pergunta: 'Qual sua cidade?' },
          { chave: 'cpf', pergunta: 'Qual seu CPF?' },
        ],
      }),
      unit,
      { cidade: 'Curitiba' },
    )
    expect(prompt).toContain('Curitiba')
    expect(prompt).toContain('Qual seu CPF?')
  })
})
