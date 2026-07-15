import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import {
  LOCALE_COOKIE,
  LOCALE_HEADER,
  isLocale,
  localeForCountry,
  type Locale,
} from '@/lib/i18n/config'

/**
 * Ordem de resolução da localidade (sem mudar a URL):
 * 1. ?lang=pt|en — override manual (útil para teste e para o usuário trocar)
 * 2. cookie alizo_locale — escolha já feita numa visita anterior
 * 3. x-vercel-ip-country — geolocalização nativa da Vercel (US → en)
 * 4. padrão pt
 */
function resolveLocale(request: NextRequest): Locale {
  const fromQuery = request.nextUrl.searchParams.get('lang')
  if (isLocale(fromQuery)) return fromQuery
  const fromCookie = request.cookies.get(LOCALE_COOKIE)?.value
  if (isLocale(fromCookie)) return fromCookie
  return localeForCountry(request.headers.get('x-vercel-ip-country'))
}

export async function middleware(request: NextRequest) {
  const locale = resolveLocale(request)
  // Propaga para os server components via request header
  request.headers.set(LOCALE_HEADER, locale)

  let response = NextResponse.next({ request })

  // Auth só onde é preciso — não paga o custo do Supabase na landing/checkout
  if (request.nextUrl.pathname.startsWith('/dashboard')) {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll()
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
            response = NextResponse.next({ request })
            cookiesToSet.forEach(({ name, value, options }) =>
              response.cookies.set(name, value, options),
            )
          },
        },
      },
    )

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      const loginUrl = new URL('/login', request.url)
      const redirect = NextResponse.redirect(loginUrl)
      redirect.cookies.set(LOCALE_COOKIE, locale, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' })
      return redirect
    }
  }

  response.cookies.set(LOCALE_COOKIE, locale, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' })
  return response
}

export const config = {
  // Tudo que renderiza página: exclui assets do Next, arquivos estáticos e APIs
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/|branding/|.*\\.[a-zA-Z0-9]+$).*)'],
}
