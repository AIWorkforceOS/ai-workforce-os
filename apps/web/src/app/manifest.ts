import type { MetadataRoute } from 'next'
import { getAppUser } from '@/lib/app-user'
import { getBrandLogoUrl } from '@/lib/branding/server'
import { brandedManifestParts } from '@/lib/branding/pwa'

// O app instalado leva o nome e o ícone da EMPRESA de quem está logado (quando ela tem logo própria); sem sessão ou sem logo, é o Alizo.
export const dynamic = 'force-dynamic'

/**
 * Manifesto do app instalável (PWA). Padrão: ícones derivados do ícone oficial da Alizo (app/icon.png) — o "maskable" é a mesma logo na zona segura sobre o
 * fundo escuro da marca. Com logo da empresa: nome e ícones dela (/api/branding/icon/…). start_url = portal do funcionário (admin cai no /dashboard pelo
 * guard do layout).
 */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  let orgName: string | null = null
  let hasLogo = false
  try {
    const appUser = await getAppUser()
    if (appUser) {
      orgName = appUser.orgName
      hasLogo = Boolean(await getBrandLogoUrl(appUser))
    }
  } catch {
    // sem sessão/erro: manifesto padrão do Alizo
  }
  const brand = brandedManifestParts({ orgName, hasLogo })
  return {
    id: '/portal-funcionario',
    name: brand.name,
    short_name: brand.shortName,
    description: `${brand.name} — ordens de serviço, fotos, assinatura e check-in em campo, com envio automático quando a internet voltar.`,
    lang: 'pt-BR',
    start_url: '/portal-funcionario',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0a0f1e',
    theme_color: '#0a0f1e',
    icons: brand.icons,
  }
}
