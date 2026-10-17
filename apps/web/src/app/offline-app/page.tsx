import type { Metadata } from 'next'
import { OfflineApp } from '@/components/portal-funcionario/offline-app'

// Casca estática do modo offline: HTML igual para todos, SEM nenhum dado de usuário (os dados vêm do
// IndexedDB do próprio aparelho, no navegador). É isto que o Service Worker guarda em cache.
export const dynamic = 'force-static'
export const metadata: Metadata = { title: 'Alizo — modo offline', robots: { index: false, follow: false } }

export default function OfflineAppPage() {
  return <OfflineApp />
}
