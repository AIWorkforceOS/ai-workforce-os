'use client'

import { useEffect } from 'react'
import './globals.css'

/**
 * Cobre erros lançados pelo próprio RootLayout (fora do alcance de
 * app/error.tsx) — precisa renderizar <html>/<body> porque substitui
 * o layout raiz inteiro. Sem provider de locale disponível aqui.
 *
 * Pré-lançamento: mostra a mensagem/stack reais em vez de um texto
 * genérico, e manda o erro pro log do servidor via
 * /api/internal/client-error-log (fire-and-forget) — ver
 * src/components/diagnostics/error-report.tsx, que não dá pra usar aqui
 * porque este boundary roda fora do RootLayout (sem providers).
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    fetch('/api/internal/client-error-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: error.message,
        stack: error.stack,
        digest: error.digest,
        route: typeof window !== 'undefined' ? window.location.pathname : undefined,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
      }),
      keepalive: true,
    }).catch(() => {})
  }, [error])

  return (
    <html lang="pt-BR">
      <body>
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center" style={{ background: '#0a0f1e' }}>
          <div>
            <h1 className="text-lg font-black text-white">Deu erro na aplicação</h1>
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
              className="rounded-xl px-4 py-2 text-xs font-bold text-slate-200 transition-all hover:bg-white/5"
              style={{ border: '1px solid rgba(255,255,255,0.12)' }}
            >
              Tentar de novo
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
      </body>
    </html>
  )
}
