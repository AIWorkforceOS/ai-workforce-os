'use client'

import { useEffect, useState } from 'react'
import { SECTOR_OPTIONS, type ProspectingJob } from '@/lib/types'
import { Badge, type BadgeVariant, Card, Input, Label } from '@/components/ui/dashboard-ui'

const SECTOR_LABELS: Record<string, string> = {
  tecnologia: 'Tecnologia',
  industria: 'Indústria',
  comercio: 'Comércio',
  servicos: 'Serviços',
  saude: 'Saúde',
  educacao: 'Educação',
}

const JOB_STATUS_LABEL: Record<string, string> = {
  pending: 'Pendente',
  running: 'Em andamento',
  done: 'Concluído',
  failed: 'Falhou',
}

const JOB_STATUS_VARIANT: Record<string, BadgeVariant> = {
  pending: 'amber',
  running: 'amber',
  done: 'green',
  failed: 'red',
}

export function ProspectingPanel({
  unitId,
  defaultCity,
  defaultState,
  availableSectors,
}: {
  unitId: string
  defaultCity: string
  defaultState: string
  availableSectors: string[]
}) {
  const [city, setCity] = useState(defaultCity)
  const [state, setState] = useState(defaultState)
  const [sectors, setSectors] = useState<string[]>(
    availableSectors.length > 0 ? availableSectors : [...SECTOR_OPTIONS],
  )
  const [jobs, setJobs] = useState<ProspectingJob[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ totalFound: number; totalNew: number } | null>(null)

  async function fetchJobs() {
    try {
      const res = await fetch(`/api/units/${unitId}/prospect/status`)
      const data = await res.json()
      if (res.ok) setJobs(data.jobs ?? [])
    } catch {
      // silencioso — não é crítico para a tela
    }
  }

  useEffect(() => {
    fetchJobs()
  }, [unitId])

  function toggleSector(sector: string) {
    setSectors((current) =>
      current.includes(sector) ? current.filter((s) => s !== sector) : [...current, sector],
    )
  }

  async function handleProspect() {
    setError(null)
    setResult(null)
    setLoading(true)
    try {
      const res = await fetch(`/api/units/${unitId}/prospect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ city, state, sectors }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Erro ao prospectar leads.')
      } else {
        setResult({ totalFound: data.totalFound, totalNew: data.totalNew })
      }
      await fetchJobs()
    } catch {
      setError('Não foi possível iniciar a prospecção.')
    }
    setLoading(false)
  }

  return (
    <Card className="flex flex-col gap-4 p-6">
      <div>
        <h2 className="text-sm font-bold text-white">Prospecção de leads</h2>
        <p className="mt-1 text-sm text-slate-400">
          Busque empresas por setor na região da unidade via Google Maps.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="prospectCity">Cidade</Label>
          <Input id="prospectCity" value={city} onChange={(e) => setCity(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="prospectState">Estado</Label>
          <Input id="prospectState" value={state} onChange={(e) => setState(e.target.value)} />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-xs font-bold uppercase tracking-wide text-slate-400">Setores</span>
        <div className="grid grid-cols-2 gap-2">
          {SECTOR_OPTIONS.map((sector) => (
            <label key={sector} className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={sectors.includes(sector)}
                onChange={() => toggleSector(sector)}
                className="accent-cyan-500"
              />
              {SECTOR_LABELS[sector]}
            </label>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {result && !error && (
        <p className="text-sm text-emerald-400">
          {result.totalFound} empresas encontradas — {result.totalNew} novos leads adicionados.
        </p>
      )}

      <button
        onClick={handleProspect}
        disabled={loading || !city || !state || sectors.length === 0}
        className="self-start rounded-xl px-4 py-2 text-sm font-bold text-white transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
        style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)', boxShadow: '0 4px 14px rgba(6,182,212,0.3)' }}
      >
        {loading ? 'Prospectando...' : 'Prospectar leads'}
      </button>

      {jobs.length > 0 && (
        <div className="pt-4" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <p className="mb-2 text-xs font-medium text-slate-500">Últimas execuções</p>
          <ul className="flex flex-col gap-2">
            {jobs.map((job) => (
              <li
                key={job.id}
                className="flex items-center justify-between rounded-xl px-3 py-2 text-xs text-slate-400"
                style={{ border: '1px solid rgba(255,255,255,0.06)' }}
              >
                <span>{job.city}, {job.state} — {job.keywords.join(', ')}</span>
                <span className="flex items-center gap-2">
                  {job.status === 'done' && <span>{job.total_new} novos</span>}
                  <Badge variant={JOB_STATUS_VARIANT[job.status] ?? 'slate'}>
                    {JOB_STATUS_LABEL[job.status] ?? job.status}
                  </Badge>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  )
}
