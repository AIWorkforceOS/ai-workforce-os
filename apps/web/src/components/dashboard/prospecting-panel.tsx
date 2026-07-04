'use client'

import { useEffect, useState } from 'react'
import { SECTOR_OPTIONS, type ProspectingJob } from '@/lib/types'

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
    <div className="flex flex-col gap-4 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      <div>
        <h2 className="text-sm font-semibold text-gray-900">Prospecção de leads</h2>
        <p className="mt-1 text-sm text-gray-500">
          Busque empresas por setor na região da unidade via Google Maps.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="prospectCity" className="text-sm font-medium text-gray-700">
            Cidade
          </label>
          <input
            id="prospectCity"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-gray-400"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="prospectState" className="text-sm font-medium text-gray-700">
            Estado
          </label>
          <input
            id="prospectState"
            value={state}
            onChange={(e) => setState(e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-gray-400"
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-gray-700">Setores</span>
        <div className="grid grid-cols-2 gap-2">
          {SECTOR_OPTIONS.map((sector) => (
            <label key={sector} className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={sectors.includes(sector)}
                onChange={() => toggleSector(sector)}
              />
              {SECTOR_LABELS[sector]}
            </label>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {result && !error && (
        <p className="text-sm text-green-600">
          {result.totalFound} empresas encontradas — {result.totalNew} novos leads adicionados.
        </p>
      )}

      <button
        onClick={handleProspect}
        disabled={loading || !city || !state || sectors.length === 0}
        className="self-start rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-700 disabled:opacity-50"
      >
        {loading ? 'Prospectando...' : 'Prospectar leads'}
      </button>

      {jobs.length > 0 && (
        <div className="border-t border-gray-100 pt-4">
          <p className="mb-2 text-xs font-medium text-gray-500">Últimas execuções</p>
          <ul className="flex flex-col gap-2">
            {jobs.map((job) => (
              <li
                key={job.id}
                className="flex items-center justify-between rounded-md border border-gray-100 px-3 py-2 text-xs text-gray-600"
              >
                <span>
                  {job.city}, {job.state} — {job.keywords.join(', ')}
                </span>
                <span className="flex items-center gap-2">
                  {job.status === 'done' && <span>{job.total_new} novos</span>}
                  <span
                    className={`rounded-full px-2 py-0.5 font-medium ${
                      job.status === 'done'
                        ? 'bg-green-100 text-green-700'
                        : job.status === 'failed'
                          ? 'bg-red-100 text-red-700'
                          : 'bg-amber-100 text-amber-700'
                    }`}
                  >
                    {JOB_STATUS_LABEL[job.status] ?? job.status}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
