import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import { getLocale } from '@/lib/i18n/server'
import { LocaleProvider } from '@/lib/i18n/client'
import '@/lib/dom-patch'
import './globals.css'

// notranslate (pedido do Vinicius, 2026-08-23): o Chrome estava oferecendo
// tradução automática nessa página, mesmo ela já estando no idioma certo —
// o resultado é texto reescrito errado ("Segunda" virando "Segmento",
// "Cor secundária" virando "Corva" etc.), sem nenhum bug real no código.
// html[translate="no"] + a meta "google notranslate" pedem pro Chrome
// nunca oferecer/aplicar tradução automática nesta página.
export function generateMetadata(): Metadata {
  const locale = getLocale()
  const base = {
    other: { google: 'notranslate' },
    applicationName: 'Alizo AI',
    // iPhone: abre em tela cheia quando instalado pela tela inicial (barra de status opaca, sem mexer no layout).
    appleWebApp: { capable: true, title: 'Alizo', statusBarStyle: 'black' as const },
    icons: { apple: '/pwa/apple-touch-icon.png' },
  }
  return locale === 'en'
    ? {
        ...base,
        title: 'Alizo — AI digital employees',
        description:
          'Digital employees that answer, sell, recruit and run your ads — 24 hours a day.',
      }
    : {
        ...base,
        title: 'Alizo — Funcionários digitais de IA',
        description:
          'Funcionários digitais que atendem, vendem, recrutam e cuidam dos seus anúncios — 24 horas por dia.',
      }
}

export const viewport: Viewport = { themeColor: '#0a0f1e' }

export default function RootLayout({ children }: { children: ReactNode }) {
  const locale = getLocale()
  return (
    <html lang={locale === 'en' ? 'en' : 'pt-BR'} translate="no" className="notranslate">
      <body>
        <LocaleProvider locale={locale}>{children}</LocaleProvider>
      </body>
    </html>
  )
}
