'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card, Input, Label } from '@/components/ui/dashboard-ui'
import { generateInitialPassword } from '@/lib/auth/provision-login'
import { AccessCreatedNotice, LoginFields, type LoginChoice } from './login-fields'

type Login = { id: string; email: string; name: string | null; isActive: boolean }

/** Acesso do cliente ao portal dele: ver logins, criar (login + senha), redefinir senha e desativar. O login enxerga só as ordens deste cliente. */
export function PortalAccessCard({ profileId }: { profileId: string }) {
  const [logins, setLogins] = useState<Login[] | null>(null)
  const [form, setForm] = useState({ email: '', name: '' })
  const [choice, setChoice] = useState<LoginChoice>({ kind: 'password', password: '' })
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [notice, setNotice] = useState<{ email: string; password: string | null; setupLink: string | null } | null>(null)

  const load = useCallback(async () => {
    const res = await fetch(`/api/client-profiles/${profileId}/portal-access`).catch(() => null)
    const body = res && res.ok ? ((await res.json().catch(() => null)) as { logins?: Login[] } | null) : null
    setLogins(body?.logins ?? [])
  }, [profileId])

  useEffect(() => {
    void load()
  }, [load])

  async function create() {
    if (!form.email.trim()) return setMessage({ ok: false, text: 'Informe o e-mail do login.' })
    setBusy('create')
    setMessage(null)
    setNotice(null)
    const res = await fetch(`/api/client-profiles/${profileId}/portal-access`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: form.email, name: form.name || undefined, login: choice.kind === 'password' ? { kind: 'password', password: choice.password } : { kind: 'invite' } }),
    }).catch(() => null)
    const body = res ? ((await res.json().catch(() => null)) as { error?: string; email?: string; setupLink?: string | null } | null) : null
    setBusy(null)
    if (!res || !res.ok) return setMessage({ ok: false, text: body?.error ?? 'Não foi possível criar o acesso.' })
    setNotice({ email: body?.email ?? form.email, password: choice.kind === 'password' ? choice.password : null, setupLink: body?.setupLink ?? null })
    setForm({ email: '', name: '' })
    setChoice({ kind: 'password', password: '' })
    await load()
  }

  async function manage(login: Login, patch: { active?: boolean; newPassword?: string }) {
    setBusy(login.id)
    setMessage(null)
    setNotice(null)
    const res = await fetch(`/api/client-profiles/${profileId}/portal-access`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: login.id, ...patch }) }).catch(() => null)
    const body = res ? ((await res.json().catch(() => null)) as { error?: string } | null) : null
    setBusy(null)
    if (!res || !res.ok) return setMessage({ ok: false, text: body?.error ?? 'Não foi possível salvar.' })
    if (patch.newPassword) setNotice({ email: login.email, password: patch.newPassword, setupLink: null })
    else setMessage({ ok: true, text: 'Acesso atualizado.' })
    await load()
  }

  return (
    <Card className="p-5">
      <h2 className="text-sm font-bold text-white">Acesso ao portal do cliente</h2>
      <p className="mt-1 text-xs text-slate-400">O cliente entra com login e senha e vê só as ordens dele: andamento, fotos, Sign Off assinado e aprovação de cotações.</p>

      <div className="mt-3 flex flex-col gap-2">
        {logins === null && <p className="text-xs text-slate-500">Carregando…</p>}
        {logins?.length === 0 && <p className="text-xs text-slate-500">Nenhum login criado ainda.</p>}
        {logins?.map((l) => (
          <div key={l.id} className="flex flex-wrap items-center gap-2 rounded-xl px-3 py-2" style={{ background: 'rgba(255,255,255,0.03)', opacity: l.isActive ? 1 : 0.55 }}>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-white">{l.email}</p>
              <p className="text-[10px] text-slate-500">{l.name ?? ''}{l.isActive ? '' : ' · desativado'}</p>
            </div>
            <button type="button" disabled={busy === l.id} onClick={() => { if (window.confirm(`Gerar uma nova senha para ${l.email}? A atual deixa de funcionar.`)) void manage(l, { newPassword: generateInitialPassword() }) }} className="rounded-lg px-2.5 py-1 text-[11px] font-bold text-cyan-300 disabled:opacity-50" style={{ border: '1px solid rgba(6,182,212,0.3)' }}>
              Nova senha
            </button>
            <button type="button" disabled={busy === l.id} onClick={() => void manage(l, { active: !l.isActive })} className="rounded-lg px-2.5 py-1 text-[11px] font-bold text-slate-300 disabled:opacity-50" style={{ border: '1px solid rgba(255,255,255,0.12)' }}>
              {l.isActive ? 'Desativar' : 'Reativar'}
            </button>
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-col gap-2 border-t pt-3" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
        <p className="text-xs font-bold text-white">Novo login</p>
        <div>
          <Label>E-mail (será o login)</Label>
          <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="gerente@cliente.com" />
        </div>
        <div>
          <Label>Nome (opcional)</Label>
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <LoginFields value={choice} onChange={setChoice} />
        <button type="button" disabled={busy === 'create'} onClick={() => void create()} className="w-fit rounded-xl px-4 py-2 text-xs font-bold text-white disabled:opacity-50" style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)' }}>
          {busy === 'create' ? 'Criando…' : 'Criar acesso'}
        </button>
      </div>
      {message && (
        <p role={message.ok ? 'status' : 'alert'} className={`mt-3 text-xs font-semibold ${message.ok ? 'text-emerald-400' : 'text-red-400'}`}>
          {message.text}
        </p>
      )}
      {notice && <div className="mt-3"><AccessCreatedNotice {...notice} /></div>}
    </Card>
  )
}
