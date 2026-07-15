import { cookies, headers } from 'next/headers'
import { DEFAULT_LOCALE, LOCALE_COOKIE, LOCALE_HEADER, isLocale, type Locale } from './config'

/**
 * Localidade da request atual (server components / route handlers).
 * O middleware já resolveu país→locale e gravou no request header;
 * o cookie cobre chamadas que não passaram pelo middleware.
 */
export function getLocale(): Locale {
  const fromHeader = headers().get(LOCALE_HEADER)
  if (isLocale(fromHeader)) return fromHeader
  const fromCookie = cookies().get(LOCALE_COOKIE)?.value
  if (isLocale(fromCookie)) return fromCookie
  return DEFAULT_LOCALE
}
