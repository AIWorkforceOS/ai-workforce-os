import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import './globals.css'

export const metadata: Metadata = {
  title: 'Alizo — Funcionários digitais de IA',
  description: 'Funcionários digitais que atendem, vendem, recrutam e cuidam dos seus anúncios — 24 horas por dia.',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  )
}
