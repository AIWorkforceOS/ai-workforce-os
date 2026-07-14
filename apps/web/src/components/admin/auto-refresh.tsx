'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCw } from 'lucide-react'

/**
 * "Tempo real" do painel: revalida os dados do server component a cada
 * `intervalSeconds` (router.refresh) e mostra a hora da última leitura.
 */
export function AutoRefresh({ intervalSeconds = 30 }: { intervalSeconds?: number }) {
  const router = useRouter()
  const [lastUpdate, setLastUpdate] = useState<string | null>(null)
  const [spinning, setSpinning] = useState(false)

  useEffect(() => {
    setLastUpdate(new Date().toLocaleTimeString('pt-BR'))
    const timer = setInterval(() => {
      router.refresh()
      setLastUpdate(new Date().toLocaleTimeString('pt-BR'))
    }, intervalSeconds * 1000)
    return () => clearInterval(timer)
  }, [router, intervalSeconds])

  return (
    <button
      type="button"
      onClick={() => {
        setSpinning(true)
        router.refresh()
        setLastUpdate(new Date().toLocaleTimeString('pt-BR'))
        setTimeout(() => setSpinning(false), 700)
      }}
      className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-[11px] font-semibold text-slate-400 transition-colors hover:text-white"
      style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}
      title={`Atualiza sozinho a cada ${intervalSeconds}s`}
    >
      <RefreshCw size={12} className={spinning ? 'animate-spin' : ''} />
      {lastUpdate ? `Atualizado às ${lastUpdate}` : 'Atualizando…'}
    </button>
  )
}
