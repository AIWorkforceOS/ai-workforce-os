'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { KeyRound, Loader2, Power, UserPlus } from 'lucide-react'
import { Input, Label } from '@/components/ui/dashboard-ui'

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
  const [result, setResult] = useState<{ email: string; tempPassword: string | null } | null>(null)

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
    setResult({ email, tempPassword: data.tempPassword ?? null })
    router.refresh()
  }

  if (result) {
    return (
      <div className="rounded-xl p-4 text-sm" style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)' }}>
        <p className="font-bold text-emerald-400">Acesso liberado para {result.email}</p>
        {result.tempPassword ? (
          <p className="mt-1 text-xs text-slate-300">
            Senha temporária (aparece só uma vez):{' '}
            <code className="rounded-lg px-2 py-0.5 font-mono text-cyan-300" style={{ background: 'rgba(6,182,212,0.1)' }}>
              {result.tempPassword}
            </code>
          </p>
        ) : (
          <p className="mt-1 text-xs text-slate-400">A conta de login já existia — a senha atual continua valendo.</p>
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
