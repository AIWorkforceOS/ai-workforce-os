'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { AlertTriangle, RotateCcw } from 'lucide-react'

/**
 * UI de diagnóstico compartilhada pelos error boundaries (app/error.tsx e
 * dashboard/error.tsx). Pré-lançamento, só o time interno usa — mostra a
 * mensagem/stack reais em vez do genérico "client-side exception" do
 * Next, e manda o erro pro log do servidor via
 * /api/internal/client-error-log (fire-and-forget) pra dar pra puxar dos
 * runtime logs da Vercel sem precisar de print de tela.
 */
export function ErrorReport({
  error,
  reset,
  compact = false,
}: {
  error: Error & { digest?: string }
  reset: () => void
  /** true quando já existe um layout (ex.: sidebar do dashboard) ao redor — evita ocupar a tela inteira */
  compact?: boolean
}) {
  const pathname = usePathname()

  useEffect(() => {
    fetch('/api/internal/client-error-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: error.message,
        stack: error.stack,
        digest: error.digest,
        route: pathname,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
      }),
      keepalive: true,
    }).catch(() => {})
  }, [error, pathname])

  return (
    <div className={`flex flex-col items-center justify-center gap-4 px-6 text-center ${compact ? 'min-h-[60vh]' : 'min-h-screen'}`}>
      <div className="flex h-12 w-12 items-center justify-center rounded-full" style={{ background: 'rgba(239,68,68,0.15)' }}>
        <AlertTriangle size={22} className="text-red-400" />
      </div>
      <div>
        <h1 className="text-lg font-black text-white">Deu erro nessa tela</h1>
        <p className="mt-1 text-sm text-slate-400">
          Já foi registrado no log do servidor{error.digest ? ` (digest ${error.digest})` : ''}.
        </p>
      </div>

      <div className="mt-2 max-w-2xl overflow-auto rounded-xl p-4 text-left" style={{ background: '#141a2b', border: '1px solid rgba(239,68,68,0.25)' }}>
        <p className="font-mono text-xs text-red-300">{error.message || 'Erro sem mensagem'}</p>
        {error.stack && (
          <pre className="mt-2 whitespace-pre-wrap font-mono text-[10px] leading-relaxed text-slate-500">{error.stack}</pre>
        )}
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={reset}
          className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold text-slate-200 transition-all hover:bg-white/5"
          style={{ border: '1px solid rgba(255,255,255,0.12)' }}
        >
          <RotateCcw size={12} /> Tentar de novo
        </button>
        <a
          href="/dashboard"
          className="rounded-xl px-4 py-2 text-xs font-bold text-white transition-all hover:scale-[1.02]"
          style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)' }}
        >
          Voltar pro dashboard
        </a>
      </div>
    </div>
  )
}
