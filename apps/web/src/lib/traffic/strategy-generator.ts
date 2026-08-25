// Gerador de estratégia de campanha do Gestor de Tráfego Pago (pedido do
// Vinicius, 2026-08-23: "o funcionário precisa de fato estudar todo o
// negócio e público alvo e criar toda a campanha... trazer um número de
// leads previsto e custo total, mas o usuário poderia mudar o valor
// investido"). Até aqui campaign_creative_drafts só guardava um spec que
// já vinha pronto de quem chamava a rota (nenhuma IA decidia público,
// verba ou objetivo) — este módulo fecha essa lacuna: lê a ficha real do
// negócio (mesmo buildCombinedBusinessContext usado pelos outros
// funcionários) e propõe a campanha inteira, pronta pra revisão humana.
//
// Verba: NUNCA decidida livremente pela IA — sempre derivada do
// orcamento_mensal_brl aprendido na entrevista (via
// strategyFromBusinessProfile, já usado pelo motor de otimização), com os
// mesmos limites min/max da conta. Sem orçamento informado na entrevista,
// cai num piso conservador (ver DEFAULT_DAILY_BUDGET_CENTS) — nunca um
// valor "inventado" pela IA. O humano pode editar livremente antes de
// aprovar (ver PATCH creative-drafts/[id]).
//
// Previsão de leads/custo: SEMPRE uma estimativa, nunca uma promessa —
// isso é dito explicitamente na UI. Quando a empresa informou um CPA alvo
// na entrevista, a previsão é matemática (verba ÷ CPA, com faixa de
// variação); sem CPA alvo, pedimos à IA uma faixa de custo-por-lead
// plausível pro tipo de negócio/região (conhecimento geral de mercado, não
// dado real da conta — conta nova não tem histórico) e fazemos a mesma
// conta em código — a IA nunca inventa o número final de leads direto,
// só estima o CPL, o cálculo é sempre determinístico.

import { generateStructuredReply } from '@/lib/openai'
import { buildCombinedBusinessContext } from '@/lib/interview/engine'
import { isVerticalKey, VERTICAL_TEMPLATES } from '@/lib/verticals/catalog'
import { strategyFromBusinessProfile } from './strategy-engine'
import { searchMetaInterests, type MetaConfig } from './meta-ads'
import type { AdPlatform, CampaignCreative, CampaignTargeting, NewCampaignSpec } from './types'

const DEFAULT_DAILY_BUDGET_CENTS = 3000 // R$30/dia — piso conservador quando a entrevista não informou orçamento
const PREDICTION_PERIOD_DAYS = 30
const PREDICTION_VARIANCE_PCT = 25 // faixa min/max em torno da estimativa central

export type GeneratedCampaignStrategy = {
  spec: NewCampaignSpec
  predictedLeadsMin: number
  predictedLeadsMax: number
  predictedTotalCostCents: number
  predictionPeriodDays: number
  reasoning: string
}

type StrategyModelOutput = {
  objective?: string
  headline?: string
  body?: string
  call_to_action?: string
  countries?: string[]
  age_min?: number
  age_max?: number
  interest_keywords?: string[]
  estimated_cpl_brl_min?: number
  estimated_cpl_brl_max?: number
  reasoning?: string
}

const META_OBJECTIVES = ['OUTCOME_LEADS', 'OUTCOME_SALES', 'OUTCOME_AWARENESS', 'OUTCOME_TRAFFIC', 'OUTCOME_ENGAGEMENT']
const GOOGLE_OBJECTIVES = ['SEARCH']

function objectiveFallback(platform: AdPlatform, campaignGoal: string | undefined): string {
  if (platform === 'google') return 'SEARCH' // única com fluxo completo nesta rodada, ver google-ads.ts
  const goal = (campaignGoal ?? '').toLowerCase()
  if (goal.includes('venda')) return 'OUTCOME_SALES'
  if (goal.includes('reconhec')) return 'OUTCOME_AWARENESS'
  return 'OUTCOME_LEADS'
}

function defaultCountryFor(defaultConversationLanguage: string | null | undefined): string {
  return defaultConversationLanguage === 'en' ? 'US' : 'BR'
}

/** Monta o prompt de sistema — função pura, testável sem rede. */
export function buildStrategySystemPrompt(params: {
  platform: AdPlatform
  organizationProfile: Record<string, unknown> | null
  agentBusinessProfile: Record<string, unknown> | null
  defaultCountry: string
  hasTargetCpa: boolean
  /** organizations.vertical_key — reforça o segmento explicitamente, pra não propor público/ângulo de outro tipo de negócio (achado real do Vinicius: campanha saiu fora do segmento). */
  verticalKey?: string | null
}): string {
  const { platform, organizationProfile, agentBusinessProfile, defaultCountry, hasTargetCpa, verticalKey } = params
  const businessContext = buildCombinedBusinessContext(organizationProfile, agentBusinessProfile)
  const objectives = platform === 'meta' ? META_OBJECTIVES : GOOGLE_OBJECTIVES
  const verticalLabel = verticalKey && isVerticalKey(verticalKey) ? VERTICAL_TEMPLATES[verticalKey].labelPt : null

  return [
    `Você é o(a) gestor(a) de tráfego pago digital, estudando o negócio de verdade para propor do zero uma campanha de anúncio em ${platform === 'meta' ? 'Meta Ads (Instagram/Facebook)' : 'Google Ads'}.`,
    verticalLabel
      ? `Segmento do negócio: ${verticalLabel}. O público-alvo, os interesses propostos e o ângulo do anúncio PRECISAM condizer com esse segmento específico — nunca com outro tipo de negócio.`
      : null,
    businessContext ??
      'Ainda não há uma ficha de negócio detalhada — proponha algo genérico, seguro e verdadeiro para uma empresa de serviços, sem inventar detalhes específicos.',
    'Antes de escrever, escolha o diferencial/valor mais forte da ficha da empresa pra ser o ângulo central do anúncio (o que faz ESTE negócio ganhar do concorrente genérico) — nunca escreva um anúncio de propósito genérico que serviria pra qualquer empresa do mesmo setor.',
    `Escolha o objetivo mais adequado entre: ${objectives.join(', ')} (siga o objetivo declarado pela empresa na ficha quando houver).`,
    'Escreva um título (headline) curto e um corpo de anúncio (body) persuasivo e verdadeiro.',
    'Nunca invente promoção, preço, prazo ou resultado que não esteja na ficha da empresa. Nunca mencione concorrentes. Respeite qualquer proibição registrada na ficha.',
    platform === 'meta'
      ? 'Proponha call_to_action (um destes códigos da Meta: LEARN_MORE, SIGN_UP, SHOP_NOW, CONTACT_US, BOOK_TRAVEL, GET_QUOTE).'
      : null,
    `Proponha o público: countries (array de códigos de país ISO-2 — use ["${defaultCountry}"] a menos que a ficha diga outra região explícita), age_min, age_max, e interest_keywords (3 a 6 palavras/temas de interesse em português relacionados ao público-alvo desta empresa — serão usados para BUSCAR interesses reais na plataforma, não são o ID final).`,
    hasTargetCpa
      ? 'A empresa já tem um custo-por-lead alvo definido — não precisa estimar CPL, ele será calculado à parte.'
      : 'Estime uma faixa REALISTA de custo por lead em reais (estimated_cpl_brl_min, estimated_cpl_brl_max) para este tipo de negócio/região/objetivo, com base em benchmarks gerais de mercado — não invente um número exato, dê uma faixa honesta.',
    'FORMATO DA RESPOSTA — responda SOMENTE um JSON válido no formato:',
    `{"objective": "...", "headline": "...", "body": "...", ${platform === 'meta' ? '"call_to_action": "...", ' : ''}"countries": ["${defaultCountry}"], "age_min": 18, "age_max": 65, "interest_keywords": ["..."],${hasTargetCpa ? '' : ' "estimated_cpl_brl_min": 0, "estimated_cpl_brl_max": 0,'} "reasoning": "2-3 frases em português explicando a estratégia (por que este público, este objetivo, este ângulo de anúncio) para o dono da empresa entender"}`,
  ]
    .filter(Boolean)
    .join(' ')
}

/**
 * Gera a estratégia completa (público, objetivo, criativo, verba,
 * previsão) a partir da ficha real do negócio. `linkUrl` é obrigatório —
 * pra onde o anúncio leva (site da empresa, aprendido em outro funcionário
 * ou informado na conexão da conta). `metaPageId` é resolvido por quem
 * chama (ver rota) a partir da Página do Facebook já conectada em
 * Conteúdo/Social, quando houver.
 */
export async function generateCampaignStrategy(params: {
  apiKey: string
  platform: AdPlatform
  organizationProfile: Record<string, unknown> | null
  agentBusinessProfile: Record<string, unknown> | null
  defaultConversationLanguage: string | null
  linkUrl: string
  metaPageId?: string | null
  metaConfig?: MetaConfig | null // pra resolver interesses reais via Graph API — omitido em modo mock/sem credenciais
  verticalKey?: string | null
}): Promise<GeneratedCampaignStrategy> {
  const strategyTargets = strategyFromBusinessProfile(params.agentBusinessProfile)
  const hasTargetCpa = Boolean(strategyTargets.target_cpa_cents)
  const defaultCountry = defaultCountryFor(params.defaultConversationLanguage)

  const systemPrompt = buildStrategySystemPrompt({
    platform: params.platform,
    organizationProfile: params.organizationProfile,
    agentBusinessProfile: params.agentBusinessProfile,
    defaultCountry,
    hasTargetCpa,
    verticalKey: params.verticalKey,
  })

  const output = await generateStructuredReply<StrategyModelOutput>({
    apiKey: params.apiKey,
    systemPrompt,
    history: [{ role: 'user', content: 'Proponha a campanha agora.' }],
    maxTokens: 700,
    temperature: 0.7,
  })

  const headline = (output.headline ?? '').trim()
  const body = (output.body ?? '').trim()
  const reasoning = (output.reasoning ?? '').trim()
  if (!headline || !body) {
    throw new Error('OpenAI não retornou um título/corpo de anúncio válidos para a estratégia.')
  }

  const objective = (output.objective ?? '').trim() || objectiveFallback(params.platform, undefined)
  const countries = output.countries?.length ? output.countries : [defaultCountry]

  // Verba: sempre derivada do orçamento real da entrevista (nunca decidida livremente pela IA).
  const dailyBudgetCents =
    strategyTargets.max_daily_budget_cents ??
    strategyTargets.min_daily_budget_cents ??
    DEFAULT_DAILY_BUDGET_CENTS

  let interestIds: string[] | undefined
  let interestSearchDegraded = false
  if (params.platform === 'meta' && params.metaConfig && output.interest_keywords?.length) {
    interestIds = []
    for (const keyword of output.interest_keywords.slice(0, 6)) {
      try {
        const matches = await searchMetaInterests(params.metaConfig, keyword)
        if (matches[0]) interestIds.push(matches[0].id)
      } catch {
        // busca de interesse é melhor-esforço — um termo sem match não derruba a estratégia inteira
      }
    }
    if (interestIds.length === 0) {
      interestIds = undefined
      // Nenhum dos interesses propostos foi resolvido de verdade (token
      // expirado, termo sem match etc.) — a segmentação caiu silenciosamente
      // pra só país+idade. Isso precisa aparecer pro humano que vai aprovar,
      // não sumir sem aviso (achado real: campanha saiu com público mais
      // genérico do que a própria estratégia pretendia).
      interestSearchDegraded = true
    }
  }

  const targeting: CampaignTargeting = {
    countries,
    ageMin: output.age_min ?? 18,
    ageMax: output.age_max ?? 65,
    ...(interestIds ? { interests: interestIds } : {}),
  }

  const creative: CampaignCreative = {
    headline,
    body,
    linkUrl: params.linkUrl,
    ...(params.platform === 'meta' ? { callToAction: (output.call_to_action ?? 'LEARN_MORE').trim() } : {}),
  }

  const spec: NewCampaignSpec = {
    name: `${headline} — gerado por IA`.slice(0, 190),
    objective,
    dailyBudgetCents,
    targeting,
    creative,
    ...(params.metaPageId ? { metaPageId: params.metaPageId } : {}),
  }

  // Previsão: matemática determinística (verba ÷ CPL), nunca um número que a IA inventa direto.
  const totalBudgetCents = dailyBudgetCents * PREDICTION_PERIOD_DAYS
  const cplCentsMin = hasTargetCpa
    ? Math.round(strategyTargets.target_cpa_cents! * 0.8)
    : Math.round((output.estimated_cpl_brl_min ?? 20) * 100)
  const cplCentsMax = hasTargetCpa
    ? Math.round(strategyTargets.target_cpa_cents! * 1.2)
    : Math.round((output.estimated_cpl_brl_max ?? 60) * 100)
  const safeCplMin = Math.max(100, Math.min(cplCentsMin, cplCentsMax)) // nunca abaixo de R$1 nem inverte a faixa
  const safeCplMax = Math.max(safeCplMin, cplCentsMax)

  const centralLeads = totalBudgetCents / ((safeCplMin + safeCplMax) / 2)
  const predictedLeadsMin = Math.max(1, Math.round(centralLeads * (1 - PREDICTION_VARIANCE_PCT / 100)))
  const predictedLeadsMax = Math.max(predictedLeadsMin, Math.round(centralLeads * (1 + PREDICTION_VARIANCE_PCT / 100)))

  return {
    spec,
    predictedLeadsMin,
    predictedLeadsMax,
    predictedTotalCostCents: totalBudgetCents,
    predictionPeriodDays: PREDICTION_PERIOD_DAYS,
    reasoning: interestSearchDegraded
      ? `${reasoning || 'Estratégia gerada a partir da ficha de negócio da empresa.'} ⚠️ Não foi possível encontrar interesses reais no Meta para os temas de público sugeridos — a campanha está indo com segmentação só por país e idade, mais ampla do que o ideal. Considere ajustar antes de aprovar.`
      : reasoning || 'Estratégia gerada a partir da ficha de negócio da empresa.',
  }
}
