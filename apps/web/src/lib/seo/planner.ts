// Motor de planejamento do funcionário de SEO — funções PURAS e
// testáveis, sem chamada de rede (mesmo princípio de
// lib/content/planner.ts e lib/traffic/strategy-engine.ts): decidem O QUE
// fazer a partir do business_profile aprendido na entrevista e do
// histórico; quem executa de fato (fetch/gerar) fica em audit.ts/generator.ts.

import type { SeoContentType } from './types'

const AUDIT_CADENCE_DAYS = 7
const DEFAULT_WEEKLY_CONTENT_FREQUENCY = 2
const CONTENT_TYPE_ROTATION: SeoContentType[] = ['blog', 'gbp_post', 'landing_page', 'gbp_description']

/** Auditorias técnicas não precisam ser diárias — o site raramente muda de estrutura de um dia para o outro. */
export function shouldRunAuditToday(params: { lastAuditAt: string | null; now?: Date }): boolean {
  if (!params.lastAuditAt) return true
  const now = params.now ?? new Date()
  const daysSince = (now.getTime() - new Date(params.lastAuditAt).getTime()) / (24 * 60 * 60 * 1000)
  return daysSince >= AUDIT_CADENCE_DAYS
}

export function seoKeywordsFrom(profile: Record<string, unknown> | null | undefined): string[] {
  const value = profile?.palavras_chave_alvo
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

export function siteUrlFrom(profile: Record<string, unknown> | null | undefined): string | null {
  const value = profile?.site_url
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

/**
 * Decide se o cron deve gerar um item de conteúdo novo hoje: conta quantos
 * itens já foram criados nos últimos 7 dias e compara com a frequência
 * semanal desejada (fixa — a entrevista de SEO não pergunta frequência,
 * ao contrário do Conteúdo/Social).
 */
export function shouldGenerateContentToday(params: {
  recentItems: { created_at: string }[]
  weeklyFrequency?: number
  now?: Date
}): boolean {
  const frequency = params.weeklyFrequency ?? DEFAULT_WEEKLY_CONTENT_FREQUENCY
  const now = params.now ?? new Date()
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  const countThisWeek = params.recentItems.filter((item) => new Date(item.created_at) >= weekAgo).length
  return countThisWeek < frequency
}

/** Roda entre os 4 tipos de conteúdo, priorizando o que está há mais tempo sem ser gerado. */
export function pickNextContentType(recentItems: { content_type: SeoContentType; created_at: string }[]): SeoContentType {
  let chosen: SeoContentType = CONTENT_TYPE_ROTATION[0]!
  let oldestTime = Infinity
  for (const contentType of CONTENT_TYPE_ROTATION) {
    const lastForType = recentItems
      .filter((item) => item.content_type === contentType)
      .reduce<number>((latest, item) => Math.max(latest, new Date(item.created_at).getTime()), -Infinity)
    if (lastForType < oldestTime) {
      oldestTime = lastForType
      chosen = contentType
    }
  }
  return chosen
}

/** Escolhe a próxima palavra-chave a receber conteúdo (blog/landing_page), priorizando a menos usada recentemente. Retorna null quando o tipo de conteúdo não precisa de palavra-chave (GBP). */
export function pickNextKeyword(params: {
  contentType: SeoContentType
  keywords: string[]
  recentItems: { target_keyword: string | null; created_at: string }[]
}): string | null {
  if (params.contentType === 'gbp_description' || params.contentType === 'gbp_post') return null
  if (params.keywords.length === 0) return null
  if (params.keywords.length === 1) return params.keywords[0]!

  let chosen = params.keywords[0]!
  let oldestTime = Infinity
  for (const keyword of params.keywords) {
    const lastForKeyword = params.recentItems
      .filter((item) => item.target_keyword === keyword)
      .reduce<number>((latest, item) => Math.max(latest, new Date(item.created_at).getTime()), -Infinity)
    if (lastForKeyword < oldestTime) {
      oldestTime = lastForKeyword
      chosen = keyword
    }
  }
  return chosen
}
