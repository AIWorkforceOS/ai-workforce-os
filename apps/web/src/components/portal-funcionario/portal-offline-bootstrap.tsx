'use client'

import { useEffect } from 'react'
import { setActiveOwner } from '@/lib/portal-funcionario/offline-store'
import { registerServiceWorker } from '@/lib/portal-funcionario/sw-register'

/**
 * Liga o modo "app de campo" no portal: define quem é o funcionário logado (a fila só envia os itens dele)
 * e registra o Service Worker. O dono é definido já na renderização, antes de qualquer efeito dos filhos.
 */
export function PortalOfflineBootstrap({ employeeId }: { employeeId: string }) {
  setActiveOwner(employeeId)
  useEffect(() => {
    void registerServiceWorker()
  }, [])
  return null
}
