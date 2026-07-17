'use client'

import { useEffect } from 'react'
import { ErrorReport } from '@/components/diagnostics/error-report'

/**
 * Sem este boundary, qualquer erro não tratado (incluindo ChunkLoadError
 * após um novo deploy, quando a aba já estava aberta com JS de uma versão
 * anterior) cai no fallback genérico do Next.js — "Application error: a
 * client-side exception has occurred" — sem botão de recuperação, deixando
 * o usuário travado fora do dashboard até fechar e reabrir a aba manualmente.
 *
 * Pré-lançamento: mostra a mensagem/stack reais (ErrorReport) em vez de um
 * texto genérico, e manda o erro pro log do servidor — ver
 * src/components/diagnostics/error-report.tsx.
 */
export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const isChunkLoadError =
    /ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module/i.test(error.message ?? '')

  useEffect(() => {
    if (isChunkLoadError) {
      window.location.reload()
    }
  }, [isChunkLoadError])

  if (isChunkLoadError) return null

  return (
    <div style={{ background: '#0a0f1e', minHeight: '100vh' }}>
      <ErrorReport error={error} reset={reset} />
    </div>
  )
}
