'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function AuthorizeRepairButton({ caseId }: { caseId: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function authorize() {
    setBusy(true)
    setError(null)
    const response = await fetch(`/api/support/cases/${caseId}/authorize`, { method: 'POST' })
    setBusy(false)
    if (!response.ok) {
      setError('Não foi possível registrar a autorização. Atualize a página e tente novamente.')
      return
    }
    router.refresh()
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        disabled={busy}
        onClick={authorize}
        className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-bold text-slate-950 disabled:opacity-50"
      >
        {busy ? 'Registrando…' : 'Autorizar este reparo'}
      </button>
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </div>
  )
}

export function RepairProposalForm({ caseId }: { caseId: string }) {
  const router = useRouter()
  const [proposal, setProposal] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    const response = await fetch(`/api/admin/support/cases/${caseId}/proposal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ proposal, scope: {} }),
    })
    setBusy(false)
    if (!response.ok) {
      setError('Não foi possível enviar a proposta.')
      return
    }
    setProposal('')
    router.refresh()
  }

  return (
    <form onSubmit={submit} className="mt-3 space-y-2">
      <textarea
        value={proposal}
        onChange={(event) => setProposal(event.target.value)}
        minLength={10}
        required
        placeholder="Explique exatamente o que será alterado, o risco e como será validado."
        className="min-h-24 w-full rounded-lg border border-white/10 bg-slate-950 p-3 text-sm text-white"
      />
      <button disabled={busy} className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-bold text-slate-950 disabled:opacity-50">
        {busy ? 'Enviando…' : 'Solicitar autorização'}
      </button>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </form>
  )
}
