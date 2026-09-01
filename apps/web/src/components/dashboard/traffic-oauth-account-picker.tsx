'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { Card, CardHeader, brandGradient } from '@/components/ui/dashboard-ui'
import type { OAuthCandidateAdAccount } from '@/lib/traffic/types'

const META_ACTIVE_STATUS = 1

/**
 * Aparece só quando o cliente administra mais de uma conta de anúncio
 * (ver app/api/traffic/accounts/oauth/callback/route.ts) — escolhe qual
 * conectar. POST /api/traffic/accounts/oauth/finalize grava a escolhida.
 */
export function TrafficOAuthAccountPicker({ sessionId, accounts }: { sessionId: string; accounts: OAuthCandidateAdAccount[] }) {
  const router = useRouter()
  const [busyAccountId, setBusyAccountId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function choose(accountId: string) {
    setBusyAccountId(accountId)
    setError(null)
    try {
      const response = await fetch('/api/traffic/accounts/oauth/finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oauth_session_id: sessionId, account_id: accountId }),
      })
      const data = (await response.json()) as { error?: string }
      if (!response.ok) {
        setError(data.error ?? 'Não foi possível conectar essa conta.')
        return
      }
      router.replace('/dashboard/traffic/connect')
      router.refresh()
    } catch {
      setError('Erro de rede ao conectar a conta.')
    } finally {
      setBusyAccountId(null)
    }
  }

  return (
    <Card className="p-6 ring-1 ring-cyan-500/30">
      <CardHeader eyebrow="quase lá" title="Qual conta de anúncio é essa?" />
      <p className="mb-4 text-xs text-slate-400">
        Você administra mais de uma conta de anúncio no Facebook — escolha qual vai trabalhar com o Tráfego Pago.
      </p>
      <div className="flex flex-col gap-2">
        {accounts.map((account) => (
          <button
            key={account.id}
            onClick={() => choose(account.id)}
            disabled={busyAccountId !== null}
            className="flex items-center justify-between gap-3 rounded-xl px-4 py-3 text-left transition-colors hover:bg-white/[0.04] disabled:opacity-60"
            style={{ border: '1px solid rgba(255,255,255,0.08)' }}
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-white">{account.name}</p>
              <p className="text-[11px] text-slate-500">
                {account.currency}
                {account.account_status !== META_ACTIVE_STATUS ? ' — atenção: status da conta não é ativo' : ''}
              </p>
            </div>
            {busyAccountId === account.id ? (
              <Loader2 size={16} className="flex-shrink-0 animate-spin text-slate-400" />
            ) : (
              <span
                className="flex-shrink-0 rounded-lg px-3 py-1.5 text-xs font-black text-white"
                style={{ background: brandGradient }}
              >
                Conectar esta
              </span>
            )}
          </button>
        ))}
      </div>
      {error && <p className="mt-3 flex items-center gap-1.5 text-xs text-red-400">{error}</p>}
    </Card>
  )
}

export function TrafficOAuthBanner({ success, error }: { success: string | null; error: string | null }) {
  if (!success && !error) return null
  return (
    <div
      className="flex items-center gap-2 rounded-xl px-4 py-3 text-xs font-semibold"
      style={
        success
          ? { background: 'rgba(34,197,94,0.1)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.25)' }
          : { background: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.25)' }
      }
    >
      {success ? <CheckCircle2 size={14} className="flex-shrink-0" /> : null}
      {success ? `Conectado com sucesso: ${success}` : error}
    </div>
  )
}
