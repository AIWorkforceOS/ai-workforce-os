'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Mail, Send, UserPlus } from 'lucide-react'
import { Input, Label } from '@/components/ui/dashboard-ui'
import { ResetPasswordButton } from '@/components/admin/org-actions'

type Owner = { email: string; name: string | null }

/**
 * Gestão do "dono da unidade" (usuário com login restrito só a esta
 * unidade — ver public.users.unit_id / can_access_unit no banco).
 * Reaproveita /api/admin/users (criação + reenvio do e-mail de boas-vindas
 * usam a mesma rota) e /api/admin/users/change-email + reset-password.
 */
export function UnitOwnerPanel({
  orgId,
  unitId,
  initialOwner,
}: {
  orgId: string
  unitId: string
  initialOwner: Owner | null
}) {
  const router = useRouter()
  const [owner, setOwner] = useState<Owner | null>(initialOwner)

  if (!owner) {
    return <CreateOwnerForm orgId={orgId} unitId={unitId} onCreated={setOwner} />
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-sm text-white">{owner.name || owner.email}</p>
        {owner.name && <p className="text-xs text-slate-400">{owner.email}</p>}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <ResendWelcomeButton orgId={orgId} unitId={unitId} email={owner.email} name={owner.name} />
        <ChangeEmailForm
          currentEmail={owner.email}
          onChanged={(newEmail) => {
            setOwner({ ...owner, email: newEmail })
            router.refresh()
          }}
        />
        <ResetPasswordButton email={owner.email} />
      </div>
    </div>
  )
}

function CreateOwnerForm({
  orgId,
  unitId,
  onCreated,
}: {
  orgId: string
  unitId: string
  onCreated: (owner: Owner) => void
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name: name || null, org_id: orgId, unit_id: unitId }),
    })
    const data = await res.json().catch(() => null)
    setBusy(false)
    if (!res.ok) {
      setError(data?.error ?? 'Erro ao criar acesso.')
      return
    }
    onCreated({ email, name: name || null })
    router.refresh()
  }

  if (!open) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-slate-400">Esta unidade ainda não tem um responsável com login próprio.</p>
        <button
          onClick={() => setOpen(true)}
          className="flex w-fit items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold text-slate-200 transition-all hover:bg-white/5"
          style={{ border: '1px solid rgba(255,255,255,0.1)' }}
        >
          <UserPlus size={12} />
          Criar acesso para o responsável
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <Label htmlFor="owner-email">E-mail</Label>
        <Input id="owner-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="responsavel@empresa.com" />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="owner-name">Nome</Label>
        <Input id="owner-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome" />
      </div>
      <button
        type="submit"
        disabled={busy}
        className="flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-xs font-black text-white disabled:opacity-50"
        style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)' }}
      >
        {busy ? <Loader2 size={12} className="animate-spin" /> : <UserPlus size={12} />}
        Criar acesso
      </button>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </form>
  )
}

function ResendWelcomeButton({
  orgId,
  unitId,
  email,
  name,
}: {
  orgId: string
  unitId: string
  email: string
  name: string | null
}) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ emailSent: boolean; setupLink: string | null } | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function resend() {
    setBusy(true)
    setError(null)
    setResult(null)
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name, org_id: orgId, unit_id: unitId }),
    })
    const data = await res.json().catch(() => null)
    setBusy(false)
    if (!res.ok) {
      setError(data?.error ?? 'Erro ao reenviar e-mail.')
      return
    }
    setResult({ emailSent: !!data.emailSent, setupLink: data.setupLink ?? null })
  }

  if (result) {
    return result.emailSent ? (
      <span className="text-xs text-emerald-400">E-mail de boas-vindas reenviado.</span>
    ) : (
      <div className="text-xs">
        <p className="text-amber-400">Não foi possível enviar automaticamente — repasse o link:</p>
        {result.setupLink && (
          <code className="mt-1 block break-all rounded-lg px-2 py-1 font-mono text-cyan-300" style={{ background: 'rgba(6,182,212,0.1)' }}>
            {result.setupLink}
          </code>
        )}
      </div>
    )
  }

  return (
    <span className="flex items-center gap-2">
      {error && <span className="text-[11px] text-red-400">{error}</span>}
      <button
        onClick={resend}
        disabled={busy}
        className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-bold text-slate-300 transition-all hover:bg-white/5 disabled:opacity-50"
        style={{ border: '1px solid rgba(255,255,255,0.1)' }}
      >
        {busy ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
        Reenviar e-mail de boas-vindas
      </button>
    </span>
  )
}

function ChangeEmailForm({ currentEmail, onChanged }: { currentEmail: string; onChanged: (newEmail: string) => void }) {
  const [open, setOpen] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const res = await fetch('/api/admin/users/change-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: currentEmail, new_email: newEmail }),
    })
    const data = await res.json().catch(() => null)
    setBusy(false)
    if (!res.ok) {
      setError(data?.error ?? 'Erro ao trocar e-mail.')
      return
    }
    setOpen(false)
    setNewEmail('')
    onChanged(newEmail)
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-bold text-slate-300 transition-all hover:bg-white/5"
        style={{ border: '1px solid rgba(255,255,255,0.1)' }}
      >
        <Mail size={11} />
        Trocar e-mail de acesso
      </button>
    )
  }

  return (
    <form onSubmit={submit} className="flex items-center gap-2">
      <Input
        type="email"
        required
        autoFocus
        value={newEmail}
        onChange={(e) => setNewEmail(e.target.value)}
        placeholder="novo@email.com"
        className="w-52"
      />
      <button
        type="submit"
        disabled={busy}
        className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-bold text-white disabled:opacity-50"
        style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)' }}
      >
        {busy ? <Loader2 size={11} className="animate-spin" /> : 'Salvar'}
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="text-[11px] text-slate-400 hover:text-slate-200"
      >
        Cancelar
      </button>
      {error && <span className="text-[11px] text-red-400">{error}</span>}
    </form>
  )
}
