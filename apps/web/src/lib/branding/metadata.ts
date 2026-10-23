import type { Metadata } from 'next'
import { getAppUser } from '@/lib/app-user'
import { getBrandLogoUrl } from './server'

/**
 * Título da aba, favicon e ícone de tela inicial com a marca da EMPRESA do usuário logado (quando ela tem logo própria). Sem sessão ou sem logo: devolve
 * só o que o layout raiz já define (Alizo). Nunca lança.
 */
export async function brandedMetadata(): Promise<Metadata> {
  try {
    const appUser = await getAppUser()
    if (!appUser) return {}
    const logo = await getBrandLogoUrl(appUser)
    if (!logo) return {}
    return {
      ...(appUser.orgName ? { title: appUser.orgName, applicationName: appUser.orgName, appleWebApp: { capable: true, title: appUser.orgName.slice(0, 20), statusBarStyle: 'black' as const } } : {}),
      icons: { icon: [{ url: '/api/branding/icon/192', type: 'image/png', sizes: '192x192' }], apple: '/api/branding/icon/180' },
    }
  } catch {
    return {}
  }
}
