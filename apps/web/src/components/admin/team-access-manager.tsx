'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, Input, Select } from '@/components/ui/dashboard-ui'
import { JOB_ROLE_DESCRIPTION, JOB_ROLE_LABEL, JOB_ROLES } from '@/lib/permissions/job-roles'

export type AccessUser = { id: string; email: string; name: string | null; role: string; jobRole: string | null; isActive: boolean }

const OPTIONS: { value: string; label: string }[] = [
  { value: 'admin', label: 'Administrador (acesso completo)' },
  ...JOB_ROLES.map((r) => ({ value: r, label: JOB_ROLE_LABEL[r] })),
  { value: 'viewer', label: 'Somente visualização' },
]

const accessOf = (u: AccessUser) => (u.role === 'viewer' ? 'viewer' : (u.jobRole ?? 'admin'))

/** Usuários e funções do escritório: criar ("Novo usuário"), trocar a função e desativar. Técnico e cliente têm telas próprias. */
export function TeamAccessManager({ users, orgId, currentUserId }: { users: AccessUser[]; orgId: string; currentUserId: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [form, setForm] = useState({ email: '', name: '', access: 'operacional' })

  async function change(user: AccessUser, patch: { access?: string; active?: boolean }) {
    setBusy(user.id)
    setMessage(null)
    const res = await fetch('/api/admin/users/access', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: user.id, ...patch }) }).catch(() => null)
    setBusy(null)
    if (!res || !res.ok) {
      const body = res ? ((await res.json().catch(() => null)) as { error?: string } | null) : null
      return setMessage({ ok: false, text: body?.error ?? 'Não foi possível salvar.' })
    }
    setMessage({ ok: true, text: 'Acesso atualizado.' })
    router.refresh()
  }

  async function create() {
    if (!form.email.trim()) return setMessage({ ok: false, text: 'Informe o e-mail.' })
    setBusy('new')
    setMessage(null)
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: form.email, name: form.name, org_id: orgId, role: form.access === 'viewer' ? 'viewer' : 'admin', job_role: form.access === 'viewer' ? 'admin' : form.access }),
    }).catch(() => null)
    const body = res ? ((await res.json().catch(() => null)) as { error?: string; emailSent?: boolean; setupLink?: string | null } | null) : null
    setBusy(null)
    if (!res || !res.ok) return setMessage({ ok: false, text: body?.error ?? 'Não foi possível criar o usuário.' })
    setMessage({ ok: true, text: body?.emailSent ? 'Usuário criado. Enviamos o e-mail de primeiro acesso.' : `Usuário criado. O e-mail não pôde ser enviado — repasse este link de primeiro acesso por um canal seguro: ${body?.setupLink ?? ''}` })
    setForm({ email: '', name: '', access: 'operacional' })
    router.refresh()
  }

  return (
    <Card className="p-5">
      <h2 className="mb-1 text-sm font-bold text-white">Usuários e funções</h2>
      <p className="mb-4 text-xs text-slate-400">Cada pessoa vê só o que a função dela permite. Técnicos usam o Portal do Funcionário e clientes usam o portal do cliente (telas próprias).</p>

      <div className="flex flex-col gap-2">
        {users.map((u) => {
          const self = u.id === currentUserId
          return (
            <div key={u.id} className="flex flex-wrap items-center gap-2 rounded-xl px-3 py-2" style={{ background: 'rgba(255,255,255,0.03)', opacity: u.isActive ? 1 : 0.55 }}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-white">{u.name || u.email}</p>
                <p className="truncate text-[11px] text-slate-500">{u.name ? u.email : ''}{self ? ' · você' : ''}{u.isActive ? '' : ' · desativado'}</p>
              </div>
              <Select value={accessOf(u)} disabled={self || busy === u.id} onChange={(e) => void change(u, { access: e.target.value })} aria-label={`Função de ${u.email}`} className="py-1.5 text-xs" style={{ minWidth: 200 }}>
                {OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
              {!self && (
                <button type="button" disabled={busy === u.id} onClick={() => void change(u, { active: !u.isActive })} className="rounded-lg px-2.5 py-1.5 text-[11px] font-bold text-slate-300 disabled:opacity-50" style={{ border: '1px solid rgba(255,255,255,0.12)' }}>
                  {u.isActive ? 'Desativar' : 'Reativar'}
                </button>
              )}
            </div>
          )
        })}
      </div>

      <div className="mt-5 flex flex-col gap-2 border-t pt-4" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
        <p className="text-xs font-bold text-white">Novo usuário</p>
        <div className="grid gap-2 sm:grid-cols-3">
          <Input type="email" placeholder="E-mail" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <Input placeholder="Nome (opcional)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Select value={form.access} onChange={(e) => setForm({ ...form, access: e.target.value })}>
            {OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
        {JOB_ROLES.includes(form.access as (typeof JOB_ROLES)[number]) && <p className="text-[11px] text-slate-500">{JOB_ROLE_DESCRIPTION[form.access as (typeof JOB_ROLES)[number]]}</p>}
        <button type="button" disabled={busy === 'new'} onClick={() => void create()} className="w-fit rounded-xl px-4 py-2 text-xs font-bold text-white disabled:opacity-50" style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)' }}>
          {busy === 'new' ? 'Criando…' : 'Criar usuário e enviar acesso'}
        </button>
      </div>
      {message && (
        <p role={message.ok ? 'status' : 'alert'} className={`mt-3 break-words text-xs font-semibold ${message.ok ? 'text-emerald-400' : 'text-red-400'}`}>
          {message.text}
        </p>
      )}
    </Card>
  )
}
