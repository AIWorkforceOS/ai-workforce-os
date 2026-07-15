import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { getLocale } from '@/lib/i18n/server'
import { LocaleProvider } from '@/lib/i18n/client'
import './globals.css'

export function generateMetadata(): Metadata {
  const locale = getLocale()
  return locale === 'en'
    ? {
        title: 'Alizo — AI digital employees',
        description:
          'Digital employees that answer, sell, recruit and run your ads — 24 hours a day.',
      }
    : {
        title: 'Alizo — Funcionários digitais de IA',
        description:
          'Funcionários digitais que atendem, vendem, recrutam e cuidam dos seus anúncios — 24 horas por dia.',
      }
}

export default function RootLayout({ children }: { children: ReactNode }) {
  const locale = getLocale()
  return (
    <html lang={locale === 'en' ? 'en' : 'pt-BR'}>
      <body>
        <LocaleProvider locale={locale}>{children}</LocaleProvider>
      </body>
    </html>
  )
}
