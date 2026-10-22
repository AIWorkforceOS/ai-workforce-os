'use client'

import { useState, type ChangeEvent, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil, Plus } from 'lucide-react'
import { Card, Input, Label, Textarea } from '@/components/ui/dashboard-ui'
import { BrandingCard } from '@/components/brand/branding-card'
import type { ClientProfile } from '@/lib/client-profiles/profile'
import { PortalAccessCard } from './portal-access-card'
import { AccessCreatedNotice, LoginFields, type LoginChoice } from './login-fields'

type Form = { name: string; address_line1: string; address_line2: string; phone: string; email: string; website: string; notes: string; payment_terms_days: string }
const empty: Form = { name: '', address_line1: '', address_line2: '', phone: '', email: '', website: '', notes: '', payment_terms_days: '' }
/** O formulário guarda o prazo como texto; a API recebe número (ou null = sem prazo padrão). */
const toPayload = (f: Partial<Form>) => ({ ...f, payment_terms_days: f.payment_terms_days === undefined || f.payment_terms_days.trim() === '' ? null : Number(f.payment_terms_days) })
const fromProfile = (p: ClientProfile): Form => ({ name: p.name, address_line1: p.address_line1 ?? '', address_line2: p.address_line2 ?? '', phone: p.phone ?? '', email: p.email ?? '', website: p.website ?? '', notes: p.notes ?? '', payment_terms_days: p.payment_terms_days == null ? '' : String(p.payment_terms_days) })

function Fields({ form, onChange, nameLocked }: { form: Form; onChange: (f: Form) => void; nameLocked?: boolean }) {
  const set = (k: keyof Form) => (e: { target: { value: string } }) => onChange({ ...form, [k]: e.target.value })
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Label>Nome do cliente *</Label>
        <Input value={form.name} onChange={set('name')} placeholder="Ex.: 360 Service Provider" />
        {nameLocked && <p className="mt-1 text-[11px] text-slate-500">Ao mudar o nome, as ordens e os logins do portal deste cliente acompanham o novo nome.</p>}
      </div>
      <div>
        <Label>Endereço (linha 1)</Label>
        <Input value={form.address_line1} onChange={set('address_line1')} placeholder="Rua, número, sala" />
      </div>
      <div>
        <Label>Cidade, estado e CEP (linha 2)</Label>
        <Input value={form.address_line2} onChange={set('address_line2')} placeholder="Miami, FL 33161" />
      </div>
      <div>
        <Label>Telefone</Label>
        <Input value={form.phone} onChange={set('phone')} placeholder="786-281-3413" />
      </div>
      <div>
        <Label>E-mail</Label>
        <Input value={form.email} onChange={set('email')} placeholder="contato@cliente.com" />
      </div>
      <div className="sm:col-span-2">
        <Label>Prazo padrão de pagamento (dias)</Label>
        <div className="flex flex-wrap items-center gap-2">
          <Input type="number" min={0} max={365} value={form.payment_terms_days} onChange={set('payment_terms_days')} placeholder="Ex.: 15" className="w-28" />
          {[15, 30, 45, 60].map((d) => (
            <button key={d} type="button" onClick={() => onChange({ ...form, payment_terms_days: String(d) })} className="rounded-md px-2 py-1 text-[11px] font-bold text-slate-200 hover:text-white" style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)' }}>
              Net {d}
            </button>
          ))}
        </div>
        <p className="mt-1 text-[11px] text-slate-500">Sugere o vencimento de cada ordem deste cliente ao finalizar (data do serviço + dias). Pode ser ajustado em cada ordem.</p>
      </div>
      <div className="sm:col-span-2">
        <Label>Site (opcional)</Label>
        <Input value={form.website} onChange={set('website')} placeholder="www.cliente.com" />
      </div>
      <div className="sm:col-span-2">
        <Label>Observações internas (não saem no PDF)</Label>
        <Textarea value={form.notes} onChange={set('notes')} rows={2} />
      </div>
    </div>
  )
}

function ClientCard({ profile }: { profile: ClientProfile }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<Form>(fromProfile(profile))
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  async function save(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setMessage(null)
    try {
      const response = await fetch(`/api/client-profiles/${profile.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(toPayload(form)) })
      const data = (await response.json().catch(() => null)) as { error?: string } | null
      if (response.ok) {
        setMessage({ ok: true, text: 'Dados salvos. As próximas ordens deste cliente já saem com eles.' })
        router.refresh()
      } else setMessage({ ok: false, text: data?.error ?? 'Não foi possível salvar.' })
    } catch {
      setMessage({ ok: false, text: 'Sem conexão. Tente de novo.' })
    }
    setBusy(false)
  }

  if (!open) {
    return (
      <Card className="flex items-center gap-4 p-4">
        {profile.logo_url ? (
          <img src={profile.logo_url} alt={`Logo de ${profile.name}`} className="h-12 w-12 rounded-lg bg-white object-contain p-1" />
        ) : (
          <div className="flex h-12 w-12 items-center justify-center rounded-lg text-xs font-black text-slate-400" style={{ background: 'rgba(255,255,255,0.06)' }}>
            sem logo
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-bold text-white">{profile.name}</h2>
          <p className="truncate text-xs text-slate-400">{[profile.address_line1, profile.phone, profile.email].filter(Boolean).join(' · ') || 'Sem dados cadastrados'}</p>
          {!profile.logo_url && <p className="text-[11px] text-amber-400">Sem logo: o Sign Off deste cliente sai com os dados da Mawi.</p>}
        </div>
        <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold text-slate-100" style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.18)' }}>
          <Pencil size={13} />
          Editar
        </button>
      </Card>
    )
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <Card className="p-5">
        <form onSubmit={save} className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-white">Editar {profile.name}</h2>
            <button type="button" onClick={() => setOpen(false)} className="text-xs font-semibold text-slate-400 underline">
              Fechar
            </button>
          </div>
          <Fields form={form} onChange={setForm} nameLocked />
          <div className="flex items-center gap-3">
            <button type="submit" disabled={busy} className="rounded-xl px-4 py-2 text-sm font-bold text-white disabled:opacity-60" style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)' }}>
              {busy ? 'Salvando…' : 'Salvar dados'}
            </button>
            {message && (
              <span role={message.ok ? 'status' : 'alert'} className={`text-xs font-semibold ${message.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                {message.text}
              </span>
            )}
          </div>
        </form>
      </Card>
      <div className="flex flex-col gap-4">
      <BrandingCard
        currentLogoUrl={profile.logo_url}
        uploadUrl={`/api/client-profiles/${profile.id}/logo`}
        title="Logo do cliente"
        description="Com a logo cadastrada, o Sign Off salvo no sistema (escritório) e o que o cliente baixa no portal dele saem com a logo e os dados deste cliente. SEM logo, saem com os dados e a logo da Mawi. O técnico e o gerente da loja sempre veem o Sign Off da Mawi, nunca o do cliente. PNG, JPEG ou WebP, até 2 MB."
      />
      <PortalAccessCard profileId={profile.id} />
      </div>
    </div>
  )
}

export function ClientProfilesManager({ initialProfiles }: { initialProfiles: ClientProfile[] }) {
  const router = useRouter()
  const [creating, setCreating] = useState(initialProfiles.length === 0)
  const [form, setForm] = useState<Form>(empty)
  const [logo, setLogo] = useState<File | null>(null)
  const [withPortal, setWithPortal] = useState(false)
  const [portal, setPortal] = useState({ email: '', name: '' })
  const [choice, setChoice] = useState<LoginChoice>({ kind: 'password', password: '' })
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [notice, setNotice] = useState<{ email: string; password: string | null; setupLink: string | null } | null>(null)

  function onLogo(event: ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0] ?? null
    if (!picked) return setLogo(null)
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(picked.type)) {
      event.target.value = ''
      return setMessage({ ok: false, text: 'Use uma imagem PNG, JPEG ou WebP.' })
    }
    if (picked.size > 2 * 1024 * 1024) {
      event.target.value = ''
      return setMessage({ ok: false, text: 'A logo deve ter no máximo 2 MB.' })
    }
    setMessage(null)
    setLogo(picked)
  }

  /** Cadastra o cliente e, no mesmo passo, envia a logo e cria o login do portal. Cada etapa relata o seu resultado; o cadastro nunca é desfeito por uma etapa opcional. */
  async function create(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    if (withPortal && !portal.email.trim()) return setMessage({ ok: false, text: 'Informe o e-mail do login do portal ou desmarque a opção.' })
    setBusy(true)
    setMessage(null)
    setNotice(null)
    const notes: string[] = []
    try {
      const response = await fetch('/api/client-profiles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(toPayload(form)) })
      const data = (await response.json().catch(() => null)) as { error?: string; warning?: string | null; profile?: { id: string } } | null
      if (!response.ok || !data?.profile) {
        setMessage({ ok: false, text: data?.error ?? 'Não foi possível cadastrar.' })
        setBusy(false)
        return
      }
      const profileId = data.profile.id
      if (data.warning) notes.push(data.warning)

      if (logo) {
        const fd = new FormData()
        fd.set('file', logo)
        const up = await fetch(`/api/client-profiles/${profileId}/logo`, { method: 'POST', body: fd }).catch(() => null)
        if (!up || !up.ok) notes.push('A logo não foi enviada — envie de novo em Editar. Enquanto isso o Sign Off sai com os dados da Mawi.')
      } else {
        notes.push('Sem logo por enquanto: o Sign Off deste cliente sai com os dados da Mawi até você anexar a logo.')
      }

      if (withPortal) {
        const res = await fetch(`/api/client-profiles/${profileId}/portal-access`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: portal.email, name: portal.name || undefined, login: choice.kind === 'password' ? { kind: 'password', password: choice.password } : { kind: 'invite' } }),
        }).catch(() => null)
        const body = res ? ((await res.json().catch(() => null)) as { error?: string; email?: string; setupLink?: string | null } | null) : null
        if (res && res.ok) setNotice({ email: body?.email ?? portal.email, password: choice.kind === 'password' ? choice.password : null, setupLink: body?.setupLink ?? null })
        else notes.push(`O acesso ao portal não foi criado: ${body?.error ?? 'tente de novo em Editar → Acesso ao portal.'}`)
      }

      setForm(empty)
      setLogo(null)
      setWithPortal(false)
      setPortal({ email: '', name: '' })
      setChoice({ kind: 'password', password: '' })
      setCreating(false)
      setMessage({ ok: true, text: ['Cliente cadastrado.', ...notes].join(' ') })
      router.refresh()
    } catch {
      setMessage({ ok: false, text: 'Sem conexão. Tente de novo.' })
    }
    setBusy(false)
  }

  return (
    <div className="flex flex-col gap-6">
      {message && (
        <p role={message.ok ? 'status' : 'alert'} className={`text-sm font-semibold ${message.ok ? 'text-emerald-400' : 'text-red-400'}`}>
          {message.text}
        </p>
      )}
      {notice && <AccessCreatedNotice {...notice} />}
      {initialProfiles.map((profile) => (
        <ClientCard key={profile.id} profile={profile} />
      ))}
      {initialProfiles.length === 0 && !creating && <p className="text-sm text-slate-400">Nenhum cliente cadastrado ainda.</p>}
      {creating ? (
        <Card className="p-5">
          <form onSubmit={create} className="flex flex-col gap-4">
            <h2 className="text-sm font-bold text-white">Novo cliente</h2>
            <Fields form={form} onChange={setForm} />
            <div className="flex flex-col gap-1.5 rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.03)' }}>
              <Label>Logo do cliente (opcional)</Label>
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={onLogo} className="text-sm text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-1.5 file:text-xs file:font-bold file:text-slate-200" />
              <p className="text-[11px] text-slate-500">Com a logo, o Sign Off do escritório e do cliente sai com a marca e os dados dele. Sem logo, sai com os dados da Mawi. O técnico sempre vê o Sign Off da Mawi. PNG, JPEG ou WebP, até 2 MB.</p>
            </div>
            <div className="flex flex-col gap-2 rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.03)' }}>
              <label className="flex items-center gap-2 text-sm font-semibold text-slate-200">
                <input type="checkbox" checked={withPortal} onChange={(e) => setWithPortal(e.target.checked)} className="accent-cyan-500" />
                Criar acesso ao portal do cliente (login e senha)
              </label>
              {withPortal && (
                <>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div>
                      <Label>E-mail (será o login) *</Label>
                      <Input type="email" value={portal.email} onChange={(e) => setPortal({ ...portal, email: e.target.value })} placeholder="gerente@cliente.com" />
                    </div>
                    <div>
                      <Label>Nome (opcional)</Label>
                      <Input value={portal.name} onChange={(e) => setPortal({ ...portal, name: e.target.value })} />
                    </div>
                  </div>
                  <LoginFields value={choice} onChange={setChoice} />
                </>
              )}
            </div>
            <div className="flex items-center gap-3">
              <button type="submit" disabled={busy || form.name.trim() === ''} className="rounded-xl px-4 py-2 text-sm font-bold text-white disabled:opacity-60" style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)' }}>
                {busy ? 'Cadastrando…' : 'Cadastrar cliente'}
              </button>
              {initialProfiles.length > 0 && (
                <button type="button" onClick={() => setCreating(false)} className="text-sm font-semibold text-slate-400 underline">
                  Cancelar
                </button>
              )}
            </div>
          </form>
        </Card>
      ) : (
        <button type="button" onClick={() => setCreating(true)} className="inline-flex w-fit items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-bold text-slate-100" style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.18)' }}>
          <Plus size={15} />
          Novo cliente
        </button>
      )}
    </div>
  )
}
