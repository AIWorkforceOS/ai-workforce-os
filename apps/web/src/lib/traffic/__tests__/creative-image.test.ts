import { describe, expect, it } from 'vitest'
import { buildCreativeImageSystemPrompt, isImageApplicable } from '../creative-image'
import type { CampaignTargeting } from '../types'

const targeting: CampaignTargeting = { countries: ['BR'], ageMin: 25, ageMax: 45 }
const creative = { headline: 'Título do anúncio', body: 'Corpo do anúncio com a promessa principal.' }

describe('isImageApplicable', () => {
  it('Meta: sempre true, qualquer objective', () => {
    expect(isImageApplicable('meta', 'OUTCOME_SALES')).toBe(true)
    expect(isImageApplicable('meta', 'OUTCOME_TRAFFIC')).toBe(true)
  })

  it('Google Search: false — Responsive Search Ad é texto puro', () => {
    expect(isImageApplicable('google', 'SEARCH')).toBe(false)
    expect(isImageApplicable('google', 'search')).toBe(false)
  })

  it('Google Display/PMax: true — canais que usam asset com imagem', () => {
    expect(isImageApplicable('google', 'DISPLAY')).toBe(true)
    expect(isImageApplicable('google', 'PERFORMANCE_MAX')).toBe(true)
  })
})

describe('buildCreativeImageSystemPrompt', () => {
  it('inclui plataforma, objetivo, texto do anúncio e público-alvo', () => {
    const prompt = buildCreativeImageSystemPrompt({
      platform: 'meta',
      objective: 'OUTCOME_SALES',
      creative,
      targeting,
      organizationProfile: null,
      agentBusinessProfile: null,
    })
    expect(prompt).toContain('Meta Ads')
    expect(prompt).toContain('OUTCOME_SALES')
    expect(prompt).toContain('Título do anúncio')
    expect(prompt).toContain('Corpo do anúncio com a promessa principal.')
    expect(prompt).toContain('países: BR')
  })

  it('menciona Google Ads quando platform é google', () => {
    const prompt = buildCreativeImageSystemPrompt({
      platform: 'google',
      objective: 'DISPLAY',
      creative,
      targeting,
      organizationProfile: null,
      agentBusinessProfile: null,
    })
    expect(prompt).toContain('Google Ads')
  })

  it('inclui a ficha do negócio quando existe business_profile', () => {
    const prompt = buildCreativeImageSystemPrompt({
      platform: 'meta',
      objective: 'OUTCOME_TRAFFIC',
      creative,
      targeting,
      organizationProfile: { org_company_name: 'Limpeza Rápida' },
      agentBusinessProfile: null,
    })
    expect(prompt).toContain('Limpeza Rápida')
  })

  it('avisa para nunca inventar promoção/preço nem citar concorrentes', () => {
    const prompt = buildCreativeImageSystemPrompt({
      platform: 'meta',
      objective: 'OUTCOME_TRAFFIC',
      creative,
      targeting,
      organizationProfile: null,
      agentBusinessProfile: null,
    })
    expect(prompt).toContain('Nunca invente promoção')
    expect(prompt).toContain('Nunca mencione concorrentes')
  })

  it('pede resposta em JSON com image_prompt e reasoning, sem texto embutido na imagem', () => {
    const prompt = buildCreativeImageSystemPrompt({
      platform: 'meta',
      objective: 'OUTCOME_TRAFFIC',
      creative,
      targeting,
      organizationProfile: null,
      agentBusinessProfile: null,
    })
    expect(prompt).toContain('"image_prompt"')
    expect(prompt).toContain('"reasoning"')
    expect(prompt).toContain('sem nenhum texto/letra/logotipo embutido na imagem')
  })

  it('regressão (2026-08-25, achado real: campanha saiu fora do segmento) — reforça o segmento do negócio explicitamente quando verticalKey é passado', () => {
    const prompt = buildCreativeImageSystemPrompt({
      platform: 'meta',
      objective: 'OUTCOME_TRAFFIC',
      creative,
      targeting,
      organizationProfile: null,
      agentBusinessProfile: null,
      verticalKey: 'cleaning_services',
    })
    expect(prompt).toContain('Serviços de Limpeza')
    expect(prompt).toContain('PRECISAM condizer com esse segmento específico')
  })

  it('sem verticalKey (ou inválida), não quebra e não menciona segmento', () => {
    expect(() =>
      buildCreativeImageSystemPrompt({
        platform: 'meta',
        objective: 'OUTCOME_TRAFFIC',
        creative,
        targeting,
        organizationProfile: null,
        agentBusinessProfile: null,
        verticalKey: 'segmento-inventado',
      }),
    ).not.toThrow()
  })

  it('se a organização tem brand kit (cores), instrui a usar as cores da marca na cena', () => {
    const prompt = buildCreativeImageSystemPrompt({
      platform: 'meta',
      objective: 'OUTCOME_TRAFFIC',
      creative,
      targeting,
      organizationProfile: { brand_kit: { primary_color: '#021E44', secondary_color: '#0B993F' } },
      agentBusinessProfile: null,
    })
    expect(prompt).toContain('#021E44')
    expect(prompt).toContain('#0B993F')
  })

  it('se apresenta como especialista em design de criativos, não só gestor de tráfego', () => {
    const prompt = buildCreativeImageSystemPrompt({
      platform: 'meta',
      objective: 'OUTCOME_TRAFFIC',
      creative,
      targeting,
      organizationProfile: null,
      agentBusinessProfile: null,
    })
    expect(prompt).toContain('especialista em design de criativos')
  })
})
