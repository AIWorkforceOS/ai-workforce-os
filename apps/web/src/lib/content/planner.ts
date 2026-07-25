// Motor de planejamento do funcionário de Conteúdo/Social — funções
// PURAS e testáveis, sem chamada de rede (mesmo princípio de
// lib/traffic/strategy-engine.ts): decidem O QUE fazer a partir do
// business_profile (aprendido na entrevista) e do histórico de posts;
// quem executa de fato (gerar/publicar) fica em generator.ts/publisher.ts.

import type { ContentPost, ContentPostStatus, PublishingMode, SocialPlatform } from './types'

const DEFAULT_WEEKLY_FREQUENCY = 3
const DEFAULT_PLATFORMS: SocialPlatform[] = ['instagram', 'facebook']

/** Status que "ocupam" a cota semanal — um post rejeitado ou que falhou não conta. */
const QUOTA_STATUSES: ContentPostStatus[] = ['draft', 'pending_approval', 'approved', 'scheduled', 'published']

export function decidePublishAction(mode: PublishingMode): 'publish' | 'queue' {
  return mode === 'autonomous' ? 'publish' : 'queue'
}

export function contentPillarsFrom(profile: Record<string, unknown> | null | undefined): string[] {
  const value = profile?.pilares_conteudo
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

export function contentPlatformsFrom(profile: Record<string, unknown> | null | undefined): SocialPlatform[] {
  const value = profile?.plataformas
  const platforms = Array.isArray(value)
    ? value.filter((item): item is SocialPlatform => item === 'instagram' || item === 'facebook')
    : []
  return platforms.length > 0 ? platforms : DEFAULT_PLATFORMS
}

export function weeklyFrequencyFrom(profile: Record<string, unknown> | null | undefined): number {
  const value = profile?.frequencia_semanal
  return typeof value === 'number' && value > 0 ? Math.round(value) : DEFAULT_WEEKLY_FREQUENCY
}

/**
 * Decide se o cron deve gerar um post novo hoje: conta quantos posts
 * "ativos" (não rejeitados/falhos) já foram criados nos últimos 7 dias
 * e compara com a frequência semanal desejada.
 */
export function shouldGenerateToday(params: {
  weeklyFrequency: number
  recentPosts: Pick<ContentPost, 'created_at' | 'status'>[]
  now?: Date
}): boolean {
  const frequency = params.weeklyFrequency > 0 ? params.weeklyFrequency : DEFAULT_WEEKLY_FREQUENCY
  const now = params.now ?? new Date()
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  const countThisWeek = params.recentPosts.filter(
    (post) => QUOTA_STATUSES.includes(post.status) && new Date(post.created_at) >= weekAgo,
  ).length
  return countThisWeek < frequency
}

/**
 * Escolhe a próxima plataforma a receber post, priorizando a que está há
 * mais tempo sem publicação (round robin por recência) — evita que uma
 * das duas fique esquecida quando a empresa usa as duas.
 */
export function pickNextPlatform(
  platforms: SocialPlatform[],
  recentPosts: Pick<ContentPost, 'platform' | 'created_at'>[],
): SocialPlatform {
  if (platforms.length === 0) throw new Error('Nenhuma plataforma disponível para postar.')
  if (platforms.length === 1) return platforms[0]!

  let chosen: SocialPlatform = platforms[0]!
  let oldestTime = Infinity
  for (const platform of platforms) {
    const lastForPlatform = recentPosts
      .filter((post) => post.platform === platform)
      .reduce<number>((latest, post) => Math.max(latest, new Date(post.created_at).getTime()), -Infinity)
    if (lastForPlatform < oldestTime) {
      oldestTime = lastForPlatform
      chosen = platform
    }
  }
  return chosen
}

/**
 * Escolhe o próximo pilar de conteúdo, evitando repetir o pilar do post
 * mais recente quando há mais de uma opção disponível.
 */
export function pickNextPillar(
  pillars: string[],
  recentPosts: Pick<ContentPost, 'content_pillar' | 'created_at'>[],
): string | null {
  if (pillars.length === 0) return null
  if (pillars.length === 1) return pillars[0]!

  const mostRecent = [...recentPosts].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  )[0]
  const lastPillar = mostRecent?.content_pillar ?? null
  const candidates = pillars.filter((pillar) => pillar !== lastPillar)
  return candidates[0] ?? pillars[0]!
}
