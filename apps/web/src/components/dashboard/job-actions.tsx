'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// Botões de ação humana sobre a vaga (§13.4): pausar, retomar/devolver
// ao agente, cancelar, disparar etapas manualmente e marcar escolhido.

const buttonBase =
  'rounded-xl px-3 py-1.5 text-[12px] font-bold transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50'

export function JobActions({ jobId, status }: { jobId: string; status: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  async function run(action: string, extra?: Record<string, unknown>) {
    setLoading(action)
    setMessage(null)
    try {
      const response = await fetch(`/api/jobs/${jobId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setMessage(data?.error ?? 'Erro ao executar a ação.')
      } else {
        setMessage(data?.message ?? 'Ação executada.')
        router.refresh()
      }
    } catch {
      setMessage('Erro de rede ao executar a ação.')
    } finally {
      setLoading(null)
    }
  }

  const isTerminal = ['handed_off', 'closed', 'cancelled', 'expired'].includes(status)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {status === 'draft' && (
          <button
            className={buttonBase}
            style={{ background: 'linear-gradient(135deg, #06b6d4, #4361ee)', color: 'white' }}
            disabled={loading !== null}
            onClick={() => run('start_intake')}
          >
            {loading === 'start_intake' ? 'Iniciando...' : 'Iniciar intake'}
          </button>
        )}
        {['profile_ready', 'sourcing', 'sourcing_expanded'].includes(status) && (
          <button
            className={buttonBase}
            style={{ background: 'linear-gradient(135deg, #06b6d4, #4361ee)', color: 'white' }}
            disabled={loading !== null}
            onClick={() => run('run_sourcing')}
          >
            {loading === 'run_sourcing' ? 'Buscando...' : 'Rodar sourcing agora'}
          </button>
        )}
        {['outreach', 'screening'].includes(status) && (
          <button
            className={buttonBase}
            style={{ background: 'linear-gradient(135deg, #06b6d4, #4361ee)', color: 'white' }}
            disabled={loading !== null}
            onClick={() => run('send_outreach')}
          >
            {loading === 'send_outreach' ? 'Enviando...' : 'Disparar próximo lote de contato'}
          </button>
        )}
        {['stalled', 'escalated_human'].includes(status) && (
          <button
            className={buttonBase}
            style={{ background: 'rgba(34,197,94,0.15)', color: '#4ade80' }}
            disabled={loading !== null}
            onClick={() => run('return_to_recruiter')}
          >
            {loading === 'return_to_recruiter' ? 'Devolvendo...' : 'Devolver ao Recruiter'}
          </button>
        )}
        {!isTerminal && !['stalled', 'escalated_human'].includes(status) && (
          <button
            className={buttonBase}
            style={{ background: 'rgba(245,158,11,0.15)', color: '#fbbf24' }}
            disabled={loading !== null}
            onClick={() => run('pause')}
          >
            {loading === 'pause' ? 'Pausando...' : 'Pausar'}
          </button>
        )}
        {!isTerminal && (
          <button
            className={buttonBase}
            style={{ background: 'rgba(239,68,68,0.15)', color: '#f87171' }}
            disabled={loading !== null}
            onClick={() => {
              if (window.confirm('Cancelar esta vaga? Candidatos em processo receberão devolutiva.')) {
                run('cancel')
              }
            }}
          >
            {loading === 'cancel' ? 'Cancelando...' : 'Cancelar vaga'}
          </button>
        )}
      </div>
      {message && <p className="text-xs text-slate-400">{message}</p>}
    </div>
  )
}

/** Botão "Marcar como escolhido" por candidato apresentado. */
export function SelectCandidateButton({ jobId, jobCandidateId }: { jobId: string; jobCandidateId: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function select() {
    if (!window.confirm('Confirmar este candidato como escolhido pela empresa? Os demais receberão devolutiva.')) return
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/jobs/${jobId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'select_candidate', candidate_id: jobCandidateId }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) setError(data?.error ?? 'Erro.')
      else router.refresh()
    } catch {
      setError('Erro de rede.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        className={buttonBase}
        style={{ background: 'rgba(34,197,94,0.15)', color: '#4ade80' }}
        disabled={loading}
        onClick={select}
      >
        {loading ? 'Confirmando...' : 'Marcar como escolhido'}
      </button>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </span>
  )
}
