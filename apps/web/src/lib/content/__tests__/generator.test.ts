import { describe, expect, it } from 'vitest'
import { buildCaptionSystemPrompt } from '../generator'
import type { AgentConfig, Unit } from '@/lib/types'

const unit = { name: 'Unidade Teste', region_city: 'Campinas' } as Unit
const config = {
  id: 'cfg-1',
  unit_id: 'unit-1',
  agent_type: 'content_specialist',
  persona_name: 'Bia',
  persona_tone: 'friendly',
  daily_limit: 15,
  active_hours: { start: '08:00', end: '18:00', days: [1, 2, 3, 4, 5] },
  escalation_rules: { after_messages: 5, keywords: [] },
  sectors: [],
  is_active: true,
  business_profile: { pilares_conteudo: ['bastidores', 'dicas'] },
  created_at: '',
  updated_at: '',
} as AgentConfig

describe('buildCaptionSystemPrompt', () => {
  it('menciona a plataforma certa e o pilar de conteúdo escolhido', () => {
    const prompt = buildCaptionSystemPrompt({
      config,
      unit,
      organizationProfile: null,
      platform: 'instagram',
      pillar: 'bastidores',
    })
    expect(prompt).toContain('Instagram')
    expect(prompt).toContain('bastidores')
  })

  it('usa Facebook quando a plataforma é facebook', () => {
    const prompt = buildCaptionSystemPrompt({
      config,
      unit,
      organizationProfile: null,
      platform: 'facebook',
      pillar: null,
    })
    expect(prompt).toContain('Facebook')
    expect(prompt).not.toContain('Instagram')
  })

  it('inclui a ficha do negócio quando existe business_profile', () => {
    const prompt = buildCaptionSystemPrompt({
      config,
      unit,
      organizationProfile: { org_company_name: 'Limpeza Rápida' },
      platform: 'instagram',
      pillar: null,
    })
    expect(prompt).toContain('Limpeza Rápida')
  })

  it('avisa para nunca inventar promoção/preço nem citar concorrentes', () => {
    const prompt = buildCaptionSystemPrompt({ config, unit, organizationProfile: null, platform: 'instagram', pillar: null })
    expect(prompt).toContain('Nunca invente promoção')
    expect(prompt).toContain('Nunca mencione concorrentes')
  })

  it('pede resposta em JSON com caption, image_prompt e reasoning', () => {
    const prompt = buildCaptionSystemPrompt({ config, unit, organizationProfile: null, platform: 'instagram', pillar: null })
    expect(prompt).toContain('"caption"')
    expect(prompt).toContain('"image_prompt"')
    expect(prompt).toContain('"reasoning"')
  })
})
