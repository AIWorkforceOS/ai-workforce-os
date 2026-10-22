import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import {
  LOCALE_COOKIE,
  LOCALE_HEADER,
  isLocale,
  localeForCountry,
  type Locale,
} from '@/lib/i18n/config'
import { canAccessModule, moduleForPath, parseJobRole, pathNeedsJobRoleCheck } from '@/lib/permissions/job-roles'

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
  if (
    request.nextUrl.pathname.startsWith('/dashboard') ||
    request.nextUrl.pathname.startsWith('/portal-funcionario') ||
    request.nextUrl.pathname.startsWith('/portal-360')
  ) {
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

    // Função do escritório (migration 104): só consulta o banco em páginas que alguma função não pode ver. A RLS continua sendo a proteção dos dados;
    // aqui a pessoa cai numa tela de "sem acesso" em vez de ver a página vazia/quebrada.
    const pathname = request.nextUrl.pathname
    if (pathname.startsWith('/dashboard') && user.email && pathNeedsJobRoleCheck(pathname)) {
      let res = await supabase.from('users').select('role, job_role').ilike('email', user.email).maybeSingle()
      if (res.error) res = await supabase.from('users').select('role').ilike('email', user.email).maybeSingle()
      const row = res.data as { role?: string; job_role?: string | null } | null
      const jobRole = row?.role === 'admin' ? parseJobRole(row.job_role) : null
      if (jobRole && !canAccessModule(jobRole, moduleForPath(pathname))) {
        const denied = NextResponse.redirect(new URL('/dashboard/sem-acesso', request.url))
        denied.cookies.set(LOCALE_COOKIE, locale, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' })
        return denied
      }
    }
  }

  response.cookies.set(LOCALE_COOKIE, locale, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' })
  return response
}

export const config = {
  // Tudo que renderiza página: exclui assets do Next, arquivos estáticos e APIs
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/|branding/|.*\\.[a-zA-Z0-9]+$).*)'],
}
