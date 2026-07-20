'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Briefcase, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Card, Input, Label, PageHeader, Select, Textarea, brandGradient } from '@/components/ui/dashboard-ui'

type UnitOption = { id: string; name: string }

export default function NewJobPage() {
  const router = useRouter()
  const [units, setUnits] = useState<UnitOption[]>([])
  const [form, setForm] = useState({
    unit_id: '',
    title: '',
    city: '',
    modality: 'presencial',
    urgency: 'normal',
    profileNotes: '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createClient()
    supabase
      .from('units')
      .select('id, name')
      .order('name')
      .then(({ data }) => {
        const rows = (data ?? []) as UnitOption[]
        setUnits(rows)
        if (rows.length > 0) setForm((f) => ({ ...f, unit_id: f.unit_id || rows[0]!.id }))
      })
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.title.trim() || !form.unit_id) {
      setError('Escolha a unidade e diga qual é a vaga.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          unit_id: form.unit_id,
          title: form.title.trim(),
          urgency: form.urgency,
          profile: {
            city: form.city.trim() || null,
            modality: form.modality,
            urgency_notes: form.profileNotes.trim() || null,
          },
          source: 'manual',
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Não foi possível abrir a vaga. Tente novamente.')
        setBusy(false)
        return
      }
      router.push(data.job?.id ? `/dashboard/recruiter/jobs/${data.job.id}` : '/dashboard/recruiter')
      router.refresh()
    } catch {
      setError('Falha de conexão. Tente novamente.')
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <PageHeader
        eyebrow="recrutador digital"
        title="Abrir uma vaga"
        subtitle="Conte o essencial — depois o recrutador conversa com você pelo WhatsApp pra fechar os detalhes do perfil ideal antes de sair divulgando."
      />

      <form onSubmit={handleSubmit}>
        <Card className="flex flex-col gap-5 p-6">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="title">Qual é a vaga?</Label>
            <Input
              id="title"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="Ex: Atendente de balcão, Estagiário de marketing…"
              required
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="unit">Unidade</Label>
              <Select id="unit" value={form.unit_id} onChange={(e) => setForm((f) => ({ ...f, unit_id: e.target.value }))}>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="city">Cidade da vaga</Label>
              <Input
                id="city"
                value={form.city}
                onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
                placeholder="Ex: Curitiba"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="modality">Formato de trabalho</Label>
              <Select id="modality" value={form.modality} onChange={(e) => setForm((f) => ({ ...f, modality: e.target.value }))}>
                <option value="presencial">Presencial</option>
                <option value="hibrido">Híbrido</option>
                <option value="remoto">Remoto</option>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="urgency">Urgência</Label>
              <Select id="urgency" value={form.urgency} onChange={(e) => setForm((f) => ({ ...f, urgency: e.target.value }))}>
                <option value="normal">Normal</option>
                <option value="high">Alta — preciso contratar rápido</option>
                <option value="low">Baixa — sem pressa</option>
              </Select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="notes">Algo importante sobre o perfil? (opcional)</Label>
            <Textarea
              id="notes"
              rows={3}
              value={form.profileNotes}
              onChange={(e) => setForm((f) => ({ ...f, profileNotes: e.target.value }))}
              placeholder="Ex: precisa ter experiência com atendimento; horário das 14h às 20h…"
            />
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={busy}
              className="flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-black text-white disabled:opacity-60"
              style={{ background: brandGradient, boxShadow: '0 4px 14px rgba(6,182,212,0.3)' }}
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Briefcase size={14} />}
              {busy ? 'Abrindo vaga...' : 'Abrir vaga'}
            </button>
            <Link href="/dashboard/recruiter" className="text-sm font-semibold text-slate-400 hover:text-slate-200">
              Cancelar
            </Link>
          </div>
        </Card>
      </form>
    </div>
  )
}
