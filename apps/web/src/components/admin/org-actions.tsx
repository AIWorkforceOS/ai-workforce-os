'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, KeyRound, Loader2, Power, RefreshCw, Trash2, UserPlus, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Input, Label, Select } from '@/components/ui/dashboard-ui'

/** Liga/desliga a empresa (super admin). */
export function ToggleOrgActive({ orgId, isActive }: { orgId: string; isActive: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function toggle() {
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/admin/orgs/${orgId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !isActive }),
    })
    setBusy(false)
    if (!res.ok) {
      const data = await res.json().catch(() => null)
      setError(data?.error ?? 'Erro ao atualizar.')
      return
    }
    router.refresh()
  }

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-red-400">{error}</span>}
      <button
        onClick={toggle}
        disabled={busy}
        className="flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold transition-all hover:bg-white/5 disabled:opacity-50"
        style={{
          border: `1px solid ${isActive ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.3)'}`,
          color: isActive ? '#f87171' : '#4ade80',
        }}
      >
        {busy ? <Loader2 size={12} className="animate-spin" /> : <Power size={12} />}
        {isActive ? 'Desativar empresa' : 'Reativar empresa'}
      </button>
    </div>
  )
}

type PlanOption = { id: string; name: string; max_units: number }

/** Troca o plano contratado da empresa a qualquer momento (super admin). */
export function ChangePlanForm({ orgId, currentPlanId }: { orgId: string; currentPlanId: string | null }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [plans, setPlans] = useState<PlanOption[]>([])
  const [selected, setSelected] = useState(currentPlanId ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || plans.length > 0) return
    const supabase = createClient()
    supabase
      .from('plans')
      .select('id, name, max_units')
      .eq('is_active', true)
      .order('sort_order')
      .then(({ data }) => setPlans((data ?? []) as PlanOption[]))
  }, [open, plans.length])

  async function save() {
    if (!selected) return
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/admin/orgs/${orgId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan_id: selected }),
    })
    const data = await res.json().catch(() => null)
    setBusy(false)
    if (!res.ok) {
      setError(data?.error ?? 'Erro ao trocar plano.')
      return
    }
    setOpen(false)
    router.refresh()
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold text-slate-200 transition-all hover:bg-white/5"
        style={{ border: '1px solid rgba(255,255,255,0.1)' }}
      >
        <RefreshCw size={12} />
        Trocar plano
      </button>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <Select value={selected} onChange={(e) => setSelected(e.target.value)} className="w-52">
        <option value="" disabled>Selecione um plano</option>
        {plans.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} — até {p.max_units} unidade{p.max_units > 1 ? 's' : ''}
          </option>
        ))}
      </Select>
      <button
        onClick={save}
        disabled={busy || !selected}
        className="flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-black text-white disabled:opacity-40"
        style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)' }}
      >
        {busy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
        Salvar
      </button>
      <button
        onClick={() => { setOpen(false); setSelected(currentPlanId ?? ''); setError(null) }}
        disabled={busy}
        className="rounded-xl px-3 py-2 text-xs font-bold text-slate-400 hover:bg-white/5 disabled:opacity-40"
      >
        Cancelar
      </button>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </div>
  )
}

/** Reset de senha de um usuário do cliente — mostra a senha temporária uma vez. */
export function ResetPasswordButton({ email }: { email: string }) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function reset() {
    if (!confirm(`Gerar nova senha temporária para ${email}? A senha atual deixa de funcionar.`)) return
    setBusy(true)
    setError(null)
    const res = await fetch('/api/admin/users/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    const data = await res.json().catch(() => null)
    setBusy(false)
    if (!res.ok) {
      setError(data?.error ?? 'Erro ao resetar senha.')
      return
    }
    setResult(data.tempPassword)
  }

  if (result) {
    return (
      <span className="flex items-center gap-2 text-xs">
        <span className="text-slate-400">Senha temporária:</span>
        <code className="rounded-lg px-2 py-1 font-mono text-cyan-300" style={{ background: 'rgba(6,182,212,0.1)' }}>{result}</code>
      </span>
    )
  }

  return (
    <span className="flex items-center gap-2">
      {error && <span className="text-[11px] text-red-400">{error}</span>}
      <button
        onClick={reset}
        disabled={busy}
        className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-bold text-slate-300 transition-all hover:bg-white/5 disabled:opacity-50"
        style={{ border: '1px solid rgba(255,255,255,0.1)' }}
      >
        {busy ? <Loader2 size={11} className="animate-spin" /> : <KeyRound size={11} />}
        Resetar senha
      </button>
    </span>
  )
}

/** Provisiona acesso de um novo usuário à org (usa /api/admin/users). */
export function ProvisionUserForm({ orgId }: { orgId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ email: string; emailSent: boolean; setupLink: string | null; note?: string } | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name, org_id: orgId }),
    })
    const data = await res.json().catch(() => null)
    setBusy(false)
    if (!res.ok) {
      setError(data?.error ?? 'Erro ao provisionar acesso.')
      return
    }
    setResult({ email, emailSent: !!data.emailSent, setupLink: data.setupLink ?? null, note: data.note })
    router.refresh()
  }

  if (result) {
    return (
      <div className="rounded-xl p-4 text-sm" style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)' }}>
        <p className="font-bold text-emerald-400">Acesso liberado para {result.email}</p>
        {result.emailSent ? (
          <p className="mt-1 text-xs text-slate-300">E-mail de boas-vindas enviado com o link de primeiro acesso.</p>
        ) : result.setupLink ? (
          <div className="mt-1 text-xs text-slate-300">
            <p className="text-amber-400">O e-mail automático não pôde ser enviado — repasse este link por canal seguro:</p>
            <code className="mt-1 block break-all rounded-lg px-2 py-1 font-mono text-cyan-300" style={{ background: 'rgba(6,182,212,0.1)' }}>
              {result.setupLink}
            </code>
          </div>
        ) : (
          <p className="mt-1 text-xs text-slate-400">{result.note ?? 'A conta de login já existia — a senha atual continua valendo.'}</p>
        )}
      </div>
    )
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold text-slate-200 transition-all hover:bg-white/5"
        style={{ border: '1px solid rgba(255,255,255,0.1)' }}
      >
        <UserPlus size={12} />
        Liberar novo acesso
      </button>
    )
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <Label htmlFor="prov-email">E-mail</Label>
        <Input id="prov-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="cliente@empresa.com" />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="prov-name">Nome</Label>
        <Input id="prov-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome da pessoa" />
      </div>
      <button
        type="submit"
        disabled={busy}
        className="flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-xs font-black text-white disabled:opacity-50"
        style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)' }}
      >
        {busy ? <Loader2 size={12} className="animate-spin" /> : <UserPlus size={12} />}
        Liberar acesso
      </button>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </form>
  )
}

export type OrgDeleteSummary = {
  units: number
  users: number
  leads: number
  conversations: number
  candidates: number
}

const SUMMARY_LABELS: Record<keyof OrgDeleteSummary, string> = {
  units: 'unidades',
  users: 'acessos de usuário',
  leads: 'leads',
  conversations: 'conversas',
  candidates: 'candidatos',
}

/**
 * Exclui uma empresa e tudo que depende dela (hard delete — ver
 * /api/admin/orgs/[id] DELETE e migration 20260716000021). Irreversível:
 * exige digitar o nome exato da organização, no padrão GitHub.
 */
export function DeleteOrgButton({ orgId, orgName, summary, compact = false }: { orgId: string; orgName: string; summary: OrgDeleteSummary; compact?: boolean }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canConfirm = confirmText === orgName

  async function submitDelete() {
    if (!canConfirm) return
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/admin/orgs/${orgId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmName: confirmText }),
    })
    const data = await res.json().catch(() => null)
    setBusy(false)
    if (!res.ok) {
      setError(data?.error ?? 'Erro ao excluir empresa.')
      return
    }
    setOpen(false)
    router.push('/dashboard/organizations')
    router.refresh()
  }

  function close() {
    if (busy) return
    setOpen(false)
    setConfirmText('')
    setError(null)
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={
          compact
            ? 'flex items-center justify-center rounded-lg p-1.5 text-slate-500 transition-all hover:bg-red-500/10 hover:text-red-400'
            : 'flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold text-red-400 transition-all hover:bg-red-500/10'
        }
        style={compact ? undefined : { border: '1px solid rgba(239,68,68,0.3)' }}
        title="Excluir empresa"
      >
        <Trash2 size={compact ? 13 : 12} />
        {!compact && 'Excluir empresa'}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }} onClick={close}>
          <div
            className="w-full max-w-md rounded-2xl p-6"
            style={{ background: '#111827', border: '1px solid rgba(239,68,68,0.3)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-full" style={{ background: 'rgba(239,68,68,0.15)' }}>
                  <AlertTriangle size={16} className="text-red-400" />
                </div>
                <div>
                  <h2 className="text-sm font-black text-white">Excluir {orgName}</h2>
                  <p className="text-[11px] text-slate-500">Ação permanente — não pode ser desfeita</p>
                </div>
              </div>
              <button onClick={close} className="text-slate-500 hover:text-slate-300">
                <X size={16} />
              </button>
            </div>

            <div className="mt-4 rounded-xl p-3 text-xs text-slate-300" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
              <p className="font-bold text-red-300">Isto vai apagar para sempre:</p>
              <ul className="mt-1.5 space-y-0.5">
                {(Object.keys(SUMMARY_LABELS) as (keyof OrgDeleteSummary)[]).map((key) => (
                  <li key={key}>
                    <span className="font-bold text-white">{summary[key]}</span> {SUMMARY_LABELS[key]}
                  </li>
                ))}
                <li>e todos os dados dependentes (vagas, candidatos no pipeline, contas de anúncio, decisões, mensagens, etc.)</li>
              </ul>
            </div>

            <div className="mt-4">
              <Label htmlFor="confirm-org-name">
                Digite <span className="text-white">{orgName}</span> para confirmar
              </Label>
              <Input
                id="confirm-org-name"
                autoFocus
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={orgName}
                className="mt-1"
              />
            </div>

            {error && <p className="mt-3 text-xs text-red-400">{error}</p>}

            <div className="mt-5 flex justify-end gap-2">
              <button onClick={close} disabled={busy} className="rounded-xl px-3.5 py-2 text-xs font-bold text-slate-300 hover:bg-white/5 disabled:opacity-50">
                Cancelar
              </button>
              <button
                onClick={submitDelete}
                disabled={!canConfirm || busy}
                className="flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-black text-white disabled:opacity-40"
                style={{ background: canConfirm ? '#dc2626' : 'rgba(220,38,38,0.4)' }}
              >
                {busy ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                Excluir permanentemente
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
