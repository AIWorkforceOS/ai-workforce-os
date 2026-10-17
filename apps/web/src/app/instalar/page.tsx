import type { Metadata } from 'next'
import { InstallGuide } from '@/components/portal-funcionario/install-guide'

// Página pública (sem login) para o técnico instalar o app: link único para mandar por WhatsApp.
export const dynamic = 'force-static'
export const metadata: Metadata = { title: 'Instalar a Alizo', robots: { index: false, follow: false } }

export default function InstallPage() {
  return <InstallGuide />
}
