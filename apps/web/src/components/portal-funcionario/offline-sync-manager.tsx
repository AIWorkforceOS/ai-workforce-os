'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { CloudOff, RefreshCw } from 'lucide-react'
import { listPendingSaves, requestPersistentStorage } from '@/lib/portal-funcionario/offline-store'
import { drainPendingSaves } from '@/lib/portal-funcionario/offline-sync'

const RETRY_INTERVAL_MS = 20_000

/**
 * Roda em segundo plano em toda a área do Portal do Funcionário (montado
 * no layout, não numa tela específica) — pedido do Vinicius
 * (2026-09-15): fotos/assinatura salvas sem internet precisam
 * sincronizar sozinhas quando a conexão voltar, mesmo que o técnico já
 * tenha saído daquela ordem. Tenta ao montar, ao reconectar
 * (`online`) e a cada 20s enquanto o app está aberto — sem Background
 * Sync (iOS Safari não suporta de verdade nem como PWA instalado), a
 * garantia real é "sincroniza enquanto o app estiver aberto", não
 * 100% em segundo plano com o app fechado.
 */
export function OfflineSyncManager() {
  const [pendingCount, setPendingCount] = useState(0)
  const [failedCount, setFailedCount] = useState(0)
  const [syncing, setSyncing] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function refreshCount() {
      const items = await listPendingSaves()
      if (cancelled) return
      setPendingCount(items.length)
      setFailedCount(items.filter((item) => item.status === 'failed').length)
      // Pede armazenamento persistente quando existe dado crítico só no aparelho (melhor momento, segundo a web.dev).
      if (items.length > 0) requestPersistentStorage()
    }

    async function drain() {
      setSyncing(true)
      await drainPendingSaves().catch(() => null)
      if (!cancelled) {
        setSyncing(false)
        await refreshCount()
      }
    }

    refreshCount()
    drain()

    const interval = setInterval(() => {
      if (navigator.onLine) drain()
    }, RETRY_INTERVAL_MS)
    window.addEventListener('online', drain)

    return () => {
      cancelled = true
      clearInterval(interval)
      window.removeEventListener('online', drain)
    }
  }, [])

  if (pendingCount === 0) return null

  return (
    <div
      className={`fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full px-4 py-2 text-xs font-bold shadow-lg ${failedCount > 0 ? 'text-red-100' : 'text-amber-200'}`}
      style={
        failedCount > 0
          ? { background: 'rgba(127,29,29,0.95)', border: '1px solid rgba(248,113,113,0.5)', backdropFilter: 'blur(8px)' }
          : { background: 'rgba(120,53,15,0.95)', border: '1px solid rgba(245,158,11,0.4)', backdropFilter: 'blur(8px)' }
      }
    >
      {syncing ? <RefreshCw size={13} className="animate-spin" /> : <CloudOff size={13} />}
      {pendingCount === 1
        ? '1 item salvo no aparelho, aguardando internet para sincronizar'
        : `${pendingCount} itens salvos no aparelho, aguardando internet para sincronizar`}
      <Link href="/portal-funcionario/sincronizacao" className="ml-1 underline">
        {failedCount > 0 ? `${failedCount} com erro — ver` : 'Ver'}
      </Link>
    </div>
  )
}
