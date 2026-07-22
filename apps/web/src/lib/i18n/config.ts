/**
 * i18n — configuração compartilhada (server + client).
 *
 * A localidade é decidida no middleware pelo país do IP
 * (header x-vercel-ip-country da Vercel): US → inglês/dólar,
 * qualquer outro país (ou ausência do header, ex.: dev local) →
 * português/real. A URL nunca muda; a escolha viaja em cookie +
 * request header.
 */

export type Locale = 'pt' | 'en'

export const LOCALE_COOKIE = 'alizo_locale'
export const LOCALE_HEADER = 'x-alizo-locale'
export const DEFAULT_LOCALE: Locale = 'pt'

export function isLocale(value: unknown): value is Locale {
  return value === 'pt' || value === 'en'
}

/** País (ISO 3166-1 alpha-2) → localidade. Só os EUA abrem em inglês. */
export function localeForCountry(country: string | null | undefined): Locale {
  return country?.toUpperCase() === 'US' ? 'en' : 'pt'
}

export type Currency = 'BRL' | 'USD'

export function currencyForLocale(locale: Locale): Currency {
  return locale === 'en' ? 'USD' : 'BRL'
}

export function formatMoney(amount: number, locale: Locale): string {
  return locale === 'en'
    ? `$${amount.toLocaleString('en-US')}`
    : `R$ ${amount.toLocaleString('pt-BR')}`
}

/**
 * Preços dos planos por moeda. O valor em dólar não é conversão de
 * câmbio ao centavo — é o preço de tabela para o mercado americano.
 * Enterprise não tem preço fixo: é "sob consulta" nos dois mercados.
 */
export const PLAN_PRICING: Record<'starter' | 'pro', { brl: number; usd: number }> = {
  starter: { brl: 497, usd: 197 },
  pro: { brl: 997, usd: 297 },
}

export type PaidPlanSlug = keyof typeof PLAN_PRICING

export function planPrice(slug: PaidPlanSlug, locale: Locale): number {
  return locale === 'en' ? PLAN_PRICING[slug].usd : PLAN_PRICING[slug].brl
}

const LANGUAGE_LABEL: Record<Locale, string> = {
  en: 'inglês (EUA)',
  pt: 'português do Brasil',
}

/**
 * Idioma padrão de atendimento da unidade (units.default_conversation_language).
 * Null = padrão histórico (pt), para não quebrar unidades já em produção
 * antes deste campo existir (mesmo molde de getUnitChannelType).
 */
export function unitDefaultLocale(unit: { default_conversation_language: Locale | null }): Locale {
  return unit.default_conversation_language ?? DEFAULT_LOCALE
}

/**
 * Diretriz de idioma para prompts de conversa real (SDR/Sales Rep,
 * Recrutador): responde no idioma padrão da unidade, mas troca de idioma
 * dinamicamente e com naturalidade se o lead/candidato pedir ou começar a
 * escrever em outro idioma — sem anunciar a troca de forma robótica.
 */
export function conversationLanguageDirective(locale: Locale): string {
  return `Responda por padrão em ${LANGUAGE_LABEL[locale]}. Se a pessoa começar a escrever em outro idioma, ou pedir para você falar em outro idioma, mude para o idioma dela a partir da próxima mensagem, com naturalidade — nunca anuncie a troca (nada de "vou mudar para..." ou "switching to..."), apenas continue a conversa nesse idioma.`
}

/** Nome do idioma por extenso — usado para rotular campos (ex.: texto de uma pergunta de fechamento). */
export function interviewLanguageLabel(locale: Locale): string {
  return LANGUAGE_LABEL[locale]
}

/**
 * Diretriz de idioma para a entrevista de contratação: responde por padrão
 * no idioma padrão da unidade, mas troca de idioma dinamicamente se o chefe
 * (quem está sendo entrevistado) pedir ou começar a escrever em outro idioma
 * — mesmo comportamento de conversationLanguageDirective, adaptado ao
 * interlocutor da entrevista (o chefe, não um lead/candidato).
 */
export function interviewLanguageDirective(locale: Locale): string {
  return `Escreva por padrão em ${LANGUAGE_LABEL[locale]}. Se o chefe começar a escrever em outro idioma, ou pedir para você falar em outro idioma, mude para o idioma dele a partir da próxima mensagem, com naturalidade — nunca anuncie a troca (nada de "vou mudar para..." ou "switching to..."), apenas continue a conversa nesse idioma.`
}
