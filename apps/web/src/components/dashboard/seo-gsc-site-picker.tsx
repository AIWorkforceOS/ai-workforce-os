'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { Card, CardHeader, brandGradient } from '@/components/ui/dashboard-ui'

/**
 * Aparece só quando a conta Google tem mais de uma propriedade verificada
 * no Search Console (ver app/api/seo/gsc/oauth/callback/route.ts) — escolhe
 * qual conectar. POST /api/seo/gsc/oauth/finalize grava a escolhida. Mesmo
 * padrão de content-oauth-page-picker.tsx.
 */
export function SeoGscSitePicker({ sessionId, siteUrls }: { sessionId: string; siteUrls: string[] }) {
  const router = useRouter()
  const [busySiteUrl, setBusySiteUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function choose(siteUrl: string) {
    setBusySiteUrl(siteUrl)
    setError(null)
    try {
      const response = await fetch('/api/seo/gsc/oauth/finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oauth_session_id: sessionId, site_url: siteUrl }),
      })
      const data = (await response.json()) as { error?: string }
      if (!response.ok) {
        setError(data.error ?? 'Não foi possível conectar essa propriedade.')
        return
      }
      router.replace('/dashboard/seo')
      router.refresh()
    } catch {
      setError('Erro de rede ao conectar a propriedade.')
    } finally {
      setBusySiteUrl(null)
    }
  }

  return (
    <Card className="p-6 ring-1 ring-cyan-500/30">
      <CardHeader eyebrow="quase lá" title="Qual propriedade é essa?" />
      <p className="mb-4 text-xs text-slate-400">
        Sua conta Google tem acesso a mais de uma propriedade no Search Console — escolha qual vai alimentar os dados reais de desempenho.
      </p>
      <div className="flex flex-col gap-2">
        {siteUrls.map((siteUrl) => (
          <button
            key={siteUrl}
            onClick={() => choose(siteUrl)}
            disabled={busySiteUrl !== null}
            className="flex items-center justify-between gap-3 rounded-xl px-4 py-3 text-left transition-colors hover:bg-white/[0.04] disabled:opacity-60"
            style={{ border: '1px solid rgba(255,255,255,0.08)' }}
          >
            <p className="truncate text-sm font-bold text-white">{siteUrl}</p>
            {busySiteUrl === siteUrl ? (
              <Loader2 size={16} className="flex-shrink-0 animate-spin text-slate-400" />
            ) : (
              <span className="flex-shrink-0 rounded-lg px-3 py-1.5 text-xs font-black text-white" style={{ background: brandGradient }}>
                Conectar esta
              </span>
            )}
          </button>
        ))}
      </div>
      {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
    </Card>
  )
}

/** Busca o desempenho real do Search Console agora, sem esperar o ciclo semanal do cron (POST .../search-console/refresh). */
export function SeoGscRefreshButton({ unitId }: { unitId: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/seo/units/${unitId}/search-console/refresh`, { method: 'POST' })
      const data = await response.json()
      if (!response.ok) {
        setError(data.error ?? 'Falha ao atualizar o desempenho.')
        return
      }
      router.refresh()
    } catch {
      setError('Erro de rede ao atualizar.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={run}
        disabled={busy}
        className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold text-white disabled:opacity-60"
        style={{ background: 'linear-gradient(135deg, #06b6d4, #4361ee)', boxShadow: '0 4px 12px rgba(6,182,212,0.25)' }}
      >
        {busy ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
        {busy ? 'Atualizando…' : 'Atualizar agora'}
      </button>
      {error && <p className="max-w-[240px] text-right text-[11px] text-red-400">{error}</p>}
    </div>
  )
}

export function SeoGscOAuthBanner({ success, error }: { success: string | null; error: string | null }) {
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
      {success ? `Search Console conectado: ${success}` : error}
    </div>
  )
}
