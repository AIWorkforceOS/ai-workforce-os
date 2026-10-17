export type InstallPlatform = 'ios-safari' | 'ios-other' | 'ios-inapp' | 'android' | 'desktop'

/** Em que navegador o técnico abriu a página de instalação (decide qual passo a passo mostrar). */
export function detectInstallPlatform(userAgent: string): InstallPlatform {
  const ua = userAgent || ''
  const ios = /iPhone|iPad|iPod/i.test(ua)
  const inApp = /FBAN|FBAV|Instagram|WhatsApp|Line\/|Messenger|Snapchat|TikTok|GSA\//i.test(ua)
  if (ios) {
    if (inApp) return 'ios-inapp'
    // CriOS/FxiOS/EdgiOS = Chrome/Firefox/Edge no iPhone; Safari de verdade não tem esses marcadores.
    return /CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua) ? 'ios-other' : 'ios-safari'
  }
  if (/Android/i.test(ua)) return 'android'
  return 'desktop'
}
