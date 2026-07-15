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
 * câmbio ao centavo — é o preço de tabela para o mercado americano
 * (R$497 ≈ US$97, R$997 ≈ US$197). Enterprise não tem preço fixo:
 * é "sob consulta" nos dois mercados.
 */
export const PLAN_PRICING: Record<'starter' | 'pro', { brl: number; usd: number }> = {
  starter: { brl: 497, usd: 97 },
  pro: { brl: 997, usd: 197 },
}

export type PaidPlanSlug = keyof typeof PLAN_PRICING

export function planPrice(slug: PaidPlanSlug, locale: Locale): number {
  return locale === 'en' ? PLAN_PRICING[slug].usd : PLAN_PRICING[slug].brl
}
