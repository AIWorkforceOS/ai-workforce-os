import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildStrategySystemPrompt } from '../strategy-generator'

describe('buildStrategySystemPrompt', () => {
  it('inclui plataforma, ficha do negócio e os objetivos válidos da Meta', () => {
    const prompt = buildStrategySystemPrompt({
      platform: 'meta',
      organizationProfile: { org_company_name: 'Mawi Building Services' },
      agentBusinessProfile: null,
      defaultCountry: 'BR',
      hasTargetCpa: false,
    })
    expect(prompt).toContain('Meta Ads')
    expect(prompt).toContain('Mawi Building Services')
    expect(prompt).toContain('OUTCOME_LEADS')
    expect(prompt).toContain('OUTCOME_SALES')
  })

  it('Google: só SEARCH como objetivo válido nesta rodada', () => {
    const prompt = buildStrategySystemPrompt({
      platform: 'google',
      organizationProfile: null,
      agentBusinessProfile: null,
      defaultCountry: 'US',
      hasTargetCpa: false,
    })
    expect(prompt).toContain('SEARCH')
    expect(prompt).not.toContain('OUTCOME_LEADS')
  })

  it('pede call_to_action só para a Meta', () => {
    const metaPrompt = buildStrategySystemPrompt({ platform: 'meta', organizationProfile: null, agentBusinessProfile: null, defaultCountry: 'BR', hasTargetCpa: false })
    const googlePrompt = buildStrategySystemPrompt({ platform: 'google', organizationProfile: null, agentBusinessProfile: null, defaultCountry: 'BR', hasTargetCpa: false })
    expect(metaPrompt).toContain('call_to_action')
    expect(googlePrompt).not.toContain('call_to_action')
  })

  it('com CPA alvo já definido, não pede estimativa de CPL à IA', () => {
    const withCpa = buildStrategySystemPrompt({ platform: 'meta', organizationProfile: null, agentBusinessProfile: null, defaultCountry: 'BR', hasTargetCpa: true })
    const withoutCpa = buildStrategySystemPrompt({ platform: 'meta', organizationProfile: null, agentBusinessProfile: null, defaultCountry: 'BR', hasTargetCpa: false })
    expect(withCpa).not.toContain('estimated_cpl_brl_min')
    expect(withoutCpa).toContain('estimated_cpl_brl_min')
  })

  it('avisa para nunca inventar promoção/preço nem citar concorrentes', () => {
    const prompt = buildStrategySystemPrompt({ platform: 'meta', organizationProfile: null, agentBusinessProfile: null, defaultCountry: 'BR', hasTargetCpa: false })
    expect(prompt).toContain('Nunca invente promoção')
    expect(prompt).toContain('Nunca mencione concorrentes')
  })

  it('usa o país default informado no exemplo de countries', () => {
    const prompt = buildStrategySystemPrompt({ platform: 'meta', organizationProfile: null, agentBusinessProfile: null, defaultCountry: 'US', hasTargetCpa: false })
    expect(prompt).toContain('["US"]')
  })

  it('regressão (2026-08-25, achado real: campanha saiu fora do segmento) — reforça o segmento do negócio explicitamente quando verticalKey é passado', () => {
    const prompt = buildStrategySystemPrompt({
      platform: 'meta',
      organizationProfile: null,
      agentBusinessProfile: null,
      defaultCountry: 'BR',
      hasTargetCpa: false,
      verticalKey: 'dental_clinic',
    })
    expect(prompt).toContain('Clínica Odontológica')
    expect(prompt).toContain('PRECISAM condizer com esse segmento específico')
  })

  it('instrui a escolher o diferencial mais forte da ficha como ângulo central, em vez de anúncio genérico', () => {
    const prompt = buildStrategySystemPrompt({ platform: 'meta', organizationProfile: null, agentBusinessProfile: null, defaultCountry: 'BR', hasTargetCpa: false })
    expect(prompt).toContain('diferencial/valor mais forte')
  })
})

describe('generateCampaignStrategy', () => {
  afterEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
  })

  async function loadWithMockedReply(reply: Record<string, unknown>) {
    vi.resetModules()
    vi.doMock('@/lib/openai', () => ({ generateStructuredReply: async () => reply }))
    return import('../strategy-generator')
  }

  it('verba diária vem do orcamento_mensal_brl da entrevista, nunca da IA (mesmo se a IA "sugerisse" outra coisa)', async () => {
    const { generateCampaignStrategy } = await loadWithMockedReply({
      objective: 'OUTCOME_LEADS',
      headline: 'Limpeza comercial de confiança',
      body: 'Atendemos escritórios e lojas em toda a região.',
      countries: ['BR'],
      age_min: 25,
      age_max: 55,
      interest_keywords: [],
      reasoning: 'Foco em leads B2B qualificados.',
    })

    const result = await generateCampaignStrategy({
      apiKey: 'k',
      platform: 'meta',
      organizationProfile: null,
      agentBusinessProfile: { orcamento_mensal_brl: 3000, cpa_alvo_brl: 50 }, // R$100/dia
      defaultConversationLanguage: 'pt',
      linkUrl: 'https://mawi.com',
    })

    expect(result.spec.dailyBudgetCents).toBe(10000) // 3000/30 * 100
    expect(result.spec.objective).toBe('OUTCOME_LEADS')
    expect(result.spec.creative.headline).toBe('Limpeza comercial de confiança')
  })

  it('previsão de leads é matemática (verba total ÷ CPA alvo, com faixa de variação) quando a empresa já tem CPA alvo', async () => {
    const { generateCampaignStrategy } = await loadWithMockedReply({
      objective: 'OUTCOME_LEADS',
      headline: 'Título',
      body: 'Corpo do anúncio.',
      countries: ['BR'],
      reasoning: 'Estratégia.',
    })

    const result = await generateCampaignStrategy({
      apiKey: 'k',
      platform: 'meta',
      organizationProfile: null,
      agentBusinessProfile: { orcamento_mensal_brl: 3000, cpa_alvo_brl: 50 }, // R$100/dia * 30 = R$3000 total; R$50/lead → ~60 leads
      defaultConversationLanguage: 'pt',
      linkUrl: 'https://mawi.com',
    })

    expect(result.predictionPeriodDays).toBe(30)
    expect(result.predictedTotalCostCents).toBe(300000) // R$3000
    // faixa em torno de 60 leads (±25%)
    expect(result.predictedLeadsMin).toBeGreaterThanOrEqual(40)
    expect(result.predictedLeadsMax).toBeLessThanOrEqual(80)
    expect(result.predictedLeadsMin).toBeLessThanOrEqual(result.predictedLeadsMax)
  })

  it('sem CPA alvo, usa a faixa de CPL estimada pela IA pro cálculo (não inventa o número de leads direto)', async () => {
    const { generateCampaignStrategy } = await loadWithMockedReply({
      objective: 'OUTCOME_LEADS',
      headline: 'Título',
      body: 'Corpo do anúncio.',
      countries: ['BR'],
      estimated_cpl_brl_min: 20,
      estimated_cpl_brl_max: 40,
      reasoning: 'Estratégia.',
    })

    const result = await generateCampaignStrategy({
      apiKey: 'k',
      platform: 'meta',
      organizationProfile: null,
      agentBusinessProfile: { orcamento_mensal_brl: 900 }, // R$30/dia * 30 = R$900
      defaultConversationLanguage: 'pt',
      linkUrl: 'https://mawi.com',
    })

    expect(result.predictedTotalCostCents).toBe(90000)
    expect(result.predictedLeadsMin).toBeGreaterThan(0)
    expect(result.predictedLeadsMax).toBeGreaterThanOrEqual(result.predictedLeadsMin)
  })

  it('sem orçamento nenhum na entrevista, cai no piso conservador (nunca R$0 nem valor inventado)', async () => {
    const { generateCampaignStrategy } = await loadWithMockedReply({
      objective: 'OUTCOME_AWARENESS',
      headline: 'Título',
      body: 'Corpo do anúncio.',
      countries: ['BR'],
      estimated_cpl_brl_min: 10,
      estimated_cpl_brl_max: 20,
      reasoning: 'Estratégia.',
    })

    const result = await generateCampaignStrategy({
      apiKey: 'k',
      platform: 'meta',
      organizationProfile: null,
      agentBusinessProfile: {},
      defaultConversationLanguage: 'pt',
      linkUrl: 'https://mawi.com',
    })

    expect(result.spec.dailyBudgetCents).toBeGreaterThan(0)
  })

  it('lança erro claro quando a IA não devolve título/corpo válidos', async () => {
    const { generateCampaignStrategy } = await loadWithMockedReply({ objective: 'OUTCOME_LEADS', countries: ['BR'] })

    await expect(
      generateCampaignStrategy({
        apiKey: 'k',
        platform: 'meta',
        organizationProfile: null,
        agentBusinessProfile: null,
        defaultConversationLanguage: 'pt',
        linkUrl: 'https://mawi.com',
      }),
    ).rejects.toThrow('título/corpo')
  })

  it('Google: usa o link e objetivo SEARCH mesmo sem a IA especificar', async () => {
    const { generateCampaignStrategy } = await loadWithMockedReply({
      headline: 'Título',
      body: 'Corpo do anúncio.',
      countries: ['BR'],
      estimated_cpl_brl_min: 15,
      estimated_cpl_brl_max: 30,
      reasoning: 'Estratégia de busca.',
    })

    const result = await generateCampaignStrategy({
      apiKey: 'k',
      platform: 'google',
      organizationProfile: null,
      agentBusinessProfile: { orcamento_mensal_brl: 1500 },
      defaultConversationLanguage: 'pt',
      linkUrl: 'https://mawi.com',
    })

    expect(result.spec.objective).toBe('SEARCH')
    expect(result.spec.creative.linkUrl).toBe('https://mawi.com')
  })
})
