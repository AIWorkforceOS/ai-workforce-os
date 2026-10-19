'use client'

import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { countPendingSaves } from '@/lib/portal-funcionario/offline-store'
import { browserRefreshDeps, refreshApp } from '@/lib/portal-funcionario/app-refresh'

/** Botão "Atualizar" para o app instalado (sem barra do navegador): busca a versão nova e recarrega, sem apagar nada guardado no aparelho. */
export function RefreshAppButton({ compact = false }: { compact?: boolean }) {
  const [busy, setBusy] = useState(false)
  async function run() {
    if (busy) return
    setBusy(true)
    const outcome = await refreshApp(browserRefreshDeps(countPendingSaves))
    if (outcome === 'cancelled') setBusy(false)
  }
  return (
    <button
      type="button"
      onClick={() => void run()}
      disabled={busy}
      aria-label="Atualizar o app"
      title="Atualizar o app"
      className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-bold text-slate-100 transition-all active:scale-[0.98] disabled:opacity-60"
      style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.18)' }}
    >
      <RefreshCw size={15} className={busy ? 'animate-spin' : ''} />
      <span className={compact ? 'hidden sm:inline' : undefined}>{busy ? 'Atualizando…' : 'Atualizar'}</span>
    </button>
  )
}
