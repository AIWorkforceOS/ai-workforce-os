import type { Locale } from '@/lib/i18n/config'
import { VERTICAL_TEMPLATES, type VerticalKey } from './catalog'

/**
 * Rótulos de terminologia por segmento de negócio (ver VERTICAL_TEMPLATES).
 * Sempre cai no termo genérico ("other") quando verticalKey é null ou a
 * categoria não define aquela chave — nunca deve faltar um rótulo.
 */
export function getTerminology(verticalKey: VerticalKey | null | undefined, locale: Locale): Record<string, string> {
  const fallback = VERTICAL_TEMPLATES.other.terminology
  const template = verticalKey ? VERTICAL_TEMPLATES[verticalKey] : undefined
  const result: Record<string, string> = {}
  for (const key of Object.keys(fallback)) {
    result[key] = template?.terminology[key]?.[locale] ?? fallback[key]![locale]
  }
  return result
}

function pluralize(term: string): string {
  return term.endsWith('s') ? term : `${term}s`
}

export function getCustomerTerm(
  verticalKey: VerticalKey | null | undefined,
  locale: Locale,
  options?: { plural?: boolean },
): string {
  const singular = getTerminology(verticalKey, locale).customer!
  return options?.plural ? pluralize(singular) : singular
}
