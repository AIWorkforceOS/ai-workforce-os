'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { Card, CardHeader, brandGradient } from '@/components/ui/dashboard-ui'
import type { OAuthCandidatePage } from '@/lib/content/types'

/**
 * Aparece só quando o cliente administra mais de uma Página do Facebook
 * (ver app/api/content/accounts/oauth/callback/route.ts) — escolhe qual
 * conectar. POST /api/content/accounts/oauth/finalize grava a escolhida.
 */
export function ContentOAuthPagePicker({ sessionId, pages }: { sessionId: string; pages: OAuthCandidatePage[] }) {
  const router = useRouter()
  const [busyPageId, setBusyPageId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function choose(pageId: string) {
    setBusyPageId(pageId)
    setError(null)
    try {
      const response = await fetch('/api/content/accounts/oauth/finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oauth_session_id: sessionId, page_id: pageId }),
      })
      const data = (await response.json()) as { error?: string }
      if (!response.ok) {
        setError(data.error ?? 'Não foi possível conectar essa Página.')
        return
      }
      router.replace('/dashboard/content/connect')
      router.refresh()
    } catch {
      setError('Erro de rede ao conectar a Página.')
    } finally {
      setBusyPageId(null)
    }
  }

  return (
    <Card className="p-6 ring-1 ring-cyan-500/30">
      <CardHeader eyebrow="quase lá" title="Qual Página é essa?" />
      <p className="mb-4 text-xs text-slate-400">
        Você administra mais de uma Página do Facebook — escolha qual vai trabalhar com o Gestor de Conteúdo.
      </p>
      <div className="flex flex-col gap-2">
        {pages.map((page) => (
          <button
            key={page.id}
            onClick={() => choose(page.id)}
            disabled={busyPageId !== null}
            className="flex items-center justify-between gap-3 rounded-xl px-4 py-3 text-left transition-colors hover:bg-white/[0.04] disabled:opacity-60"
            style={{ border: '1px solid rgba(255,255,255,0.08)' }}
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-white">{page.name}</p>
              <p className="text-[11px] text-slate-500">
                {page.instagram_username ? `Instagram vinculado: @${page.instagram_username}` : 'Sem Instagram Business vinculado (só publica no Facebook)'}
              </p>
            </div>
            {busyPageId === page.id ? (
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
      {error && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-red-400">{error}</p>
      )}
    </Card>
  )
}

export function ContentOAuthBanner({ success, error }: { success: string | null; error: string | null }) {
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
