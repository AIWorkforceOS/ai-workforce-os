'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import { Card, Input, Label, Textarea } from '@/components/ui/dashboard-ui'
import { BrandingCard } from '@/components/brand/branding-card'
import type { ClientProfile } from '@/lib/client-profiles/profile'

type Form = { name: string; address_line1: string; address_line2: string; phone: string; email: string; website: string; notes: string }
const empty: Form = { name: '', address_line1: '', address_line2: '', phone: '', email: '', website: '', notes: '' }
const fromProfile = (p: ClientProfile): Form => ({ name: p.name, address_line1: p.address_line1 ?? '', address_line2: p.address_line2 ?? '', phone: p.phone ?? '', email: p.email ?? '', website: p.website ?? '', notes: p.notes ?? '' })

function Fields({ form, onChange, nameLocked }: { form: Form; onChange: (f: Form) => void; nameLocked?: boolean }) {
  const set = (k: keyof Form) => (e: { target: { value: string } }) => onChange({ ...form, [k]: e.target.value })
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Label>Nome do cliente *</Label>
        <Input value={form.name} onChange={set('name')} disabled={nameLocked} placeholder="Ex.: 360 Service Provider" />
        {nameLocked && <p className="mt-1 text-[11px] text-slate-500">O nome liga o cliente às ordens e não muda depois de cadastrado.</p>}
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
  const [form, setForm] = useState<Form>(fromProfile(profile))
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  async function save(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setMessage(null)
    const { name: _name, ...fields } = form
    void _name
    try {
      const response = await fetch(`/api/client-profiles/${profile.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields) })
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

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <Card className="p-5">
        <form onSubmit={save} className="flex flex-col gap-4">
          <h2 className="text-sm font-bold text-white">{profile.name}</h2>
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
      <BrandingCard
        currentLogoUrl={profile.logo_url}
        uploadUrl={`/api/client-profiles/${profile.id}/logo`}
        title="Logo do cliente"
        description="Sai no canto superior da ordem de serviço (PDF) deste cliente. PNG, JPEG ou WebP, até 2 MB."
      />
    </div>
  )
}

export function ClientProfilesManager({ initialProfiles }: { initialProfiles: ClientProfile[] }) {
  const router = useRouter()
  const [creating, setCreating] = useState(initialProfiles.length === 0)
  const [form, setForm] = useState<Form>(empty)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  async function create(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setMessage(null)
    try {
      const response = await fetch('/api/client-profiles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
      const data = (await response.json().catch(() => null)) as { error?: string; warning?: string | null } | null
      if (response.ok) {
        setForm(empty)
        setCreating(false)
        setMessage({ ok: true, text: data?.warning ?? 'Cliente cadastrado. Agora envie a logo dele.' })
        router.refresh()
      } else setMessage({ ok: false, text: data?.error ?? 'Não foi possível cadastrar.' })
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
      {initialProfiles.map((profile) => (
        <ClientCard key={profile.id} profile={profile} />
      ))}
      {initialProfiles.length === 0 && !creating && <p className="text-sm text-slate-400">Nenhum cliente cadastrado ainda.</p>}
      {creating ? (
        <Card className="p-5">
          <form onSubmit={create} className="flex flex-col gap-4">
            <h2 className="text-sm font-bold text-white">Novo cliente</h2>
            <Fields form={form} onChange={setForm} />
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
