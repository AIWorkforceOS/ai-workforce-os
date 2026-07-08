'use client'

import { useState } from 'react'
import { Activity } from 'lucide-react'

type HealthResult = { key: string; label: string; ok: boolean; detail: string }

export function IntegrationHealthButton() {
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<HealthResult[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function runHealthCheck() {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/integrations/health', { method: 'POST' })
      const data = await response.json()
      if (!response.ok) throw new Error(data?.error ?? 'Falha no teste de conexões.')
      setResults(data.results as HealthResult[])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha no teste de conexões.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        onClick={runHealthCheck}
        disabled={busy}
        className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-bold text-cyan-300 transition-all hover:bg-cyan-500/10 disabled:opacity-50"
        style={{ border: '1px solid rgba(6,182,212,0.3)' }}
      >
        <Activity size={12} />
        {busy ? 'Testando...' : 'Testar conexões'}
      </button>
      {error && <p className="text-[10px] text-red-400">{error}</p>}
      {results && (
        <div className="flex flex-wrap justify-end gap-1.5">
          {results.map((result) => (
            <span
              key={result.key}
              title={result.detail}
              className="rounded-full px-2 py-0.5 text-[10px] font-bold"
              style={
                result.ok
                  ? { background: 'rgba(34,197,94,0.12)', color: '#4ade80' }
                  : { background: 'rgba(239,68,68,0.12)', color: '#f87171' }
              }
            >
              {result.label}: {result.ok ? 'OK' : 'falhou'}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
