// Motor de planejamento do funcionário de Conteúdo/Social — funções
// PURAS e testáveis, sem chamada de rede (mesmo princípio de
// lib/traffic/strategy-engine.ts): decidem O QUE fazer a partir do
// business_profile (aprendido na entrevista) e do histórico de posts;
// quem executa de fato (gerar/publicar) fica em generator.ts/publisher.ts.

import type { ContentPost, ContentPostStatus, PublishingMode, SocialPlatform } from './types'

const DEFAULT_WEEKLY_FREQUENCY = 3
const DEFAULT_PLATFORMS: SocialPlatform[] = ['instagram', 'facebook']

/** Status que "ocupam" a cota semanal — um post rejeitado ou que falhou não conta. */
export const QUOTA_STATUSES: ContentPostStatus[] = ['draft', 'pending_approval', 'approved', 'scheduled', 'published']

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

/** Segunda=1 ... Domingo=7 (ISO). Espalhamento padrão quando a empresa não escolheu dias específicos. */
const DEFAULT_POSTING_DAYS_BY_FREQUENCY: Record<number, number[]> = {
  1: [3],
  2: [2, 5],
  3: [1, 3, 5],
  4: [1, 2, 4, 5],
  5: [1, 2, 3, 4, 5],
  6: [1, 2, 3, 4, 5, 6],
  7: [1, 2, 3, 4, 5, 6, 7],
}

/**
 * Dias da semana (planejamento semanal, pedido do Vinicius 2026-08-23) em
 * que a empresa quer postar — ex: [1,3,5] = seg/qua/sex. Sem escolha
 * explícita, cai num espalhamento padrão a partir da frequência semanal
 * já existente, pra nunca deixar o planejamento sem nenhum dia.
 */
export function postingDaysFrom(profile: Record<string, unknown> | null | undefined): number[] {
  const value = profile?.dias_publicacao
  if (Array.isArray(value)) {
    const days = value.filter((day): day is number => typeof day === 'number' && day >= 1 && day <= 7)
    if (days.length > 0) return [...new Set(days)].sort((a, b) => a - b)
  }
  const clampedFrequency = Math.min(7, Math.max(1, weeklyFrequencyFrom(profile)))
  return DEFAULT_POSTING_DAYS_BY_FREQUENCY[clampedFrequency] ?? [1, 3, 5]
}

function addDaysUtc(date: Date, days: number): Date {
  const result = new Date(date)
  result.setUTCDate(result.getUTCDate() + days)
  return result
}

/** Segunda-feira (00:00 UTC) da semana ISO que contém a data. */
function mondayOfWeek(date: Date): Date {
  const isoWeekday = date.getUTCDay() === 0 ? 7 : date.getUTCDay()
  const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  monday.setUTCDate(monday.getUTCDate() - (isoWeekday - 1))
  return monday
}

/**
 * Datas (uma por dia da semana selecionado) da semana ISO que contém
 * referenceDate — só as que ainda não passaram, pra completar o
 * planejamento do resto da semana atual quando chamado no meio dela
 * (ex: botão "gerar planejamento semanal" clicado numa quarta-feira).
 */
export function currentWeekDates(postingDays: number[], referenceDate: Date): Date[] {
  const monday = mondayOfWeek(referenceDate)
  const today = new Date(Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth(), referenceDate.getUTCDate()))
  return postingDays
    .filter((day) => day >= 1 && day <= 7)
    .map((isoWeekday) => addDaysUtc(monday, isoWeekday - 1))
    .filter((date) => date.getTime() >= today.getTime())
    .sort((a, b) => a.getTime() - b.getTime())
}

/** As 7 datas (segunda a domingo) da semana ISO que contém referenceDate, sem filtrar passado/futuro — usado na exibição do calendário. */
export function fullWeekDates(referenceDate: Date): Date[] {
  const monday = mondayOfWeek(referenceDate)
  return Array.from({ length: 7 }, (_, i) => addDaysUtc(monday, i))
}

/** Datas da semana SEGUINTE à que contém referenceDate — usado no gatilho automático de toda sexta-feira. */
export function nextWeekDates(postingDays: number[], referenceDate: Date): Date[] {
  const nextMonday = addDaysUtc(mondayOfWeek(referenceDate), 7)
  return postingDays
    .filter((day) => day >= 1 && day <= 7)
    .map((isoWeekday) => addDaysUtc(nextMonday, isoWeekday - 1))
    .sort((a, b) => a.getTime() - b.getTime())
}

/**
 * Datas-alvo pro botão manual "gerar planejamento semanal" (pedido do
 * Vinicius, 2026-08-23): completa o que resta da semana atual — e, se não
 * sobrar nenhum dia (clicado sexta à noite, fim de semana, ou já
 * planejado), cai automaticamente pra semana seguinte, sem precisar o
 * usuário escolher.
 */
export function resolveWeekPlanDates(postingDays: number[], referenceDate: Date): Date[] {
  const remaining = currentWeekDates(postingDays, referenceDate)
  return remaining.length > 0 ? remaining : nextWeekDates(postingDays, referenceDate)
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
/**
 * Achado real em produção (2026-08-28, conta AlizoAi, 3 pilares
 * configurados): a versão antiga só evitava repetir o pilar do post
 * IMEDIATAMENTE anterior, sempre devolvendo `candidates[0]` — com 3+
 * pilares isso trava num ping-pong eterno entre os 2 primeiros da lista
 * (ex.: A→B→A→B→A...), o terceiro pilar NUNCA é escolhido. Agora é um
 * round-robin de verdade: escolhe o pilar que ficou mais tempo sem ser
 * usado (nunca usado conta como "mais tempo sem uso" de todos).
 */
export function pickNextPillar(
  pillars: string[],
  recentPosts: Pick<ContentPost, 'content_pillar' | 'created_at'>[],
): string | null {
  if (pillars.length === 0) return null
  if (pillars.length === 1) return pillars[0]!

  const sortedByRecency = [...recentPosts].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  )
  // Posição (0 = mais recente) da última vez que cada pilar foi usado — quanto maior, mais tempo sem aparecer.
  const lastUsedRank = new Map<string, number>()
  sortedByRecency.forEach((post, index) => {
    if (post.content_pillar && !lastUsedRank.has(post.content_pillar)) {
      lastUsedRank.set(post.content_pillar, index)
    }
  })
  const staleness = (pillar: string) => lastUsedRank.get(pillar) ?? Number.POSITIVE_INFINITY // nunca usado = mais "velho" que qualquer um já usado
  return [...pillars].sort((a, b) => staleness(b) - staleness(a))[0]!
}

/**
 * Formatos/ângulos visuais concretos que a imagem de um post pode assumir —
 * pedido do Vinicius (2026-08-28, conta AlizoAi): mesmo com a instrução em
 * texto reforçada 2x pedindo "varie o formato visual", os criativos
 * continuaram seguindo a mesma linha (robôs + telas de dashboard +
 * azul/turquesa) post após post. Cada entrada é a instrução completa já
 * pronta pra entrar no prompt de imagem — não é só um rótulo.
 */
export const VISUAL_ANGLES = [
  'fotografia realista de pessoas de verdade em ação (equipe trabalhando, cliente sendo atendido) — sem elementos de tela/dashboard/tecnologia visíveis na cena',
  'ilustração/composição gráfica abstrata com formas geométricas e cor sólida — sem nenhuma figura humana realista nem tela de computador',
  'close-up extremo de um único objeto ou detalhe específico do negócio, enchendo o quadro inteiro — sem ambiente ao redor visível',
  'peça no estilo infográfico: ícones simples + um número ou dado em destaque sobre fundo liso — sem foto nem cena realista',
  'cena minimalista com um único elemento pequeno centralizado num fundo vazio e limpo — bastante espaço negativo',
  'comparação lado a lado (split-screen) mostrando antes/depois ou dois cenários opostos',
  'um personagem ilustrado (mascote, avatar cartoon) em ação numa situação do dia a dia do negócio — estilo desenho, não foto',
] as const

/**
 * Escolhe o próximo ângulo visual, no mesmo espírito round-robin/LRU de
 * pickNextPillar (que resolveu o mesmo tipo de bug pro pilar de conteúdo):
 * o formato que ficou mais tempo sem ser usado vence, nunca repete o
 * imediatamente anterior quando há alternativa. Deixar o modelo "escolher
 * livremente" já foi tentado e não funcionou — precisa ser decidido em
 * código, antes do prompt, e imposto como obrigatório.
 */
export function pickNextVisualAngle(recentPosts: Pick<ContentPost, 'visual_angle' | 'created_at'>[]): string {
  const sortedByRecency = [...recentPosts].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  )
  const lastUsedRank = new Map<string, number>()
  sortedByRecency.forEach((post, index) => {
    if (post.visual_angle && !lastUsedRank.has(post.visual_angle)) {
      lastUsedRank.set(post.visual_angle, index)
    }
  })
  const staleness = (angle: string) => lastUsedRank.get(angle) ?? Number.POSITIVE_INFINITY
  return [...VISUAL_ANGLES].sort((a, b) => staleness(b) - staleness(a))[0]!
}
