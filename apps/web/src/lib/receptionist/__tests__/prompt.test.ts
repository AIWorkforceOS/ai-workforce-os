import { describe, expect, it, vi } from 'vitest'

// getUnitChannelType decide "sms" vs demais canais no prompt (frase de
// limite de 160 caracteres) — mockado pra controlar isso por teste sem
// depender de infra de canal real.
const getUnitChannelTypeMock = vi.fn(() => 'whatsapp' as string)
vi.mock('@/lib/channels/messaging-channel', () => ({
  getUnitChannelType: () => getUnitChannelTypeMock(),
}))

import { buildReceptionistSystemPrompt } from '../prompt'
import type { AgentConfig, Unit } from '@/lib/types'

const unit = { name: 'Unidade Teste', region_city: 'Campinas', default_conversation_language: 'pt' } as Unit

function baseConfig(businessProfile: Record<string, unknown> = {}): AgentConfig {
  return {
    id: 'cfg-1',
    unit_id: 'unit-1',
    agent_type: 'receptionist',
    persona_name: 'Ana',
    persona_tone: 'friendly',
    daily_limit: 15,
    active_hours: { start: '08:00', end: '18:00', days: [1, 2, 3, 4, 5] },
    escalation_rules: { after_messages: 5, keywords: [] },
    sectors: [],
    is_active: true,
    business_profile: businessProfile,
    created_at: '',
    updated_at: '',
  } as AgentConfig
}

describe('buildReceptionistSystemPrompt', () => {
  it('inclui a ficha do negócio quando existe business_profile', () => {
    const prompt = buildReceptionistSystemPrompt(baseConfig({ tipo_negocio: 'clínica odontológica' }), unit, null)
    expect(prompt).toContain('clínica odontológica')
  })

  it('funde a ficha compartilhada da organização com a do agente', () => {
    const prompt = buildReceptionistSystemPrompt(baseConfig({ tipo_negocio: 'clínica odontológica' }), unit, {
      org_company_name: 'Sorriso Feliz',
    })
    expect(prompt).toContain('Sorriso Feliz')
    expect(prompt).toContain('clínica odontológica')
  })

  it('inclui quando avisar um humano e quem avisar, quando a ficha ensinou isso', () => {
    const prompt = buildReceptionistSystemPrompt(
      baseConfig({ quando_avisar_humano: 'reclamação ou cancelamento', quem_avisar: 'gerente Carla' }),
      unit,
      null,
    )
    expect(prompt).toContain('reclamação ou cancelamento')
    expect(prompt).toContain('gerente Carla')
  })

  it('usa o limite de SMS (até 160 caracteres) só quando o canal da unidade é SMS', () => {
    getUnitChannelTypeMock.mockReturnValueOnce('sms')
    const smsPrompt = buildReceptionistSystemPrompt(baseConfig(), unit, null)
    expect(smsPrompt).toContain('160 caracteres')

    getUnitChannelTypeMock.mockReturnValueOnce('whatsapp')
    const whatsappPrompt = buildReceptionistSystemPrompt(baseConfig(), unit, null)
    expect(whatsappPrompt).not.toContain('160 caracteres')
  })

  it('nunca deixa a persona vender ou recrutar — deixa claro que a função é operação/atendimento', () => {
    const prompt = buildReceptionistSystemPrompt(baseConfig(), unit, null)
    expect(prompt).toContain('NÃO é vender nem recrutar')
  })
})
