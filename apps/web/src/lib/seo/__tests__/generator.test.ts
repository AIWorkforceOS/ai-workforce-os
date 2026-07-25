import { describe, expect, it } from 'vitest'
import { buildSeoContentSystemPrompt } from '../generator'
import type { AgentConfig, Unit } from '@/lib/types'

const unit = { name: 'Unidade Teste', region_city: 'Campinas' } as Unit
const config = {
  id: 'cfg-1',
  unit_id: 'unit-1',
  agent_type: 'seo_specialist',
  persona_name: 'Léo',
  persona_tone: 'professional',
  daily_limit: 5,
  active_hours: { start: '08:00', end: '18:00', days: [1, 2, 3, 4, 5] },
  escalation_rules: { after_messages: 5, keywords: [] },
  sectors: [],
  is_active: true,
  business_profile: { site_url: 'https://example.com', palavras_chave_alvo: ['limpeza residencial'] },
  created_at: '',
  updated_at: '',
} as AgentConfig

describe('buildSeoContentSystemPrompt', () => {
  it('menciona o tipo de conteúdo e a palavra-chave', () => {
    const prompt = buildSeoContentSystemPrompt({ config, unit, organizationProfile: null, contentType: 'blog', keyword: 'limpeza residencial' })
    expect(prompt).toContain('post de blog')
    expect(prompt).toContain('limpeza residencial')
  })

  it('usa instruções diferentes para landing_page', () => {
    const prompt = buildSeoContentSystemPrompt({ config, unit, organizationProfile: null, contentType: 'landing_page', keyword: 'faxina' })
    expect(prompt).toContain('landing page')
    expect(prompt).not.toContain('POST DE BLOG')
  })

  it('usa instruções específicas de Google Business Profile e não exige palavra-chave', () => {
    const prompt = buildSeoContentSystemPrompt({ config, unit, organizationProfile: null, contentType: 'gbp_description', keyword: null })
    expect(prompt).toContain('Google Business Profile')
    expect(prompt).toContain('750 caracteres')
  })

  it('inclui a ficha do negócio quando existe business_profile', () => {
    const prompt = buildSeoContentSystemPrompt({ config, unit, organizationProfile: { org_company_name: 'Limpeza Rápida' }, contentType: 'blog', keyword: null })
    expect(prompt).toContain('Limpeza Rápida')
  })

  it('avisa para nunca inventar promoção/preço nem citar concorrentes', () => {
    const prompt = buildSeoContentSystemPrompt({ config, unit, organizationProfile: null, contentType: 'blog', keyword: null })
    expect(prompt).toContain('Nunca invente promoção')
    expect(prompt).toContain('Nunca mencione concorrentes')
  })

  it('pede resposta em JSON com title, body_markdown e image_prompt', () => {
    const prompt = buildSeoContentSystemPrompt({ config, unit, organizationProfile: null, contentType: 'blog', keyword: null })
    expect(prompt).toContain('"title"')
    expect(prompt).toContain('"body_markdown"')
    expect(prompt).toContain('"image_prompt"')
  })
})
