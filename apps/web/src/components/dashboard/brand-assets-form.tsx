'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Images, Loader2 } from 'lucide-react'
import { Card, CardHeader, Label } from '@/components/ui/dashboard-ui'

export type BeforeAfterPair = { id: string; before_url: string; after_url: string; description?: string }

export function BrandAssetsForm({ unitId, initialPairs }: { unitId: string; initialPairs: BeforeAfterPair[] }) {
  const router = useRouter()
  const [before, setBefore] = useState<File | null>(null)
  const [after, setAfter] = useState<File | null>(null)
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!before || !after) return setMessage('Selecione as fotos de antes e depois do mesmo serviço.')
    setBusy(true)
    setMessage(null)
    const form = new FormData()
    form.append('unit_id', unitId)
    form.append('before', before)
    form.append('after', after)
    form.append('description', description)
    const response = await fetch('/api/content/brand-assets', { method: 'POST', body: form })
    const data = await response.json().catch(() => null)
    setBusy(false)
    if (!response.ok) return setMessage(data?.error ?? 'Não foi possível enviar as fotos.')
    setBefore(null)
    setAfter(null)
    setDescription('')
    setMessage('Par salvo. O Gestor nunca separará estas duas fotos.')
    router.refresh()
  }

  return (
    <Card className="p-6">
      <CardHeader eyebrow="biblioteca visual" title="Antes e depois sem risco de mistura" />
      <p className="mb-4 text-xs text-slate-400">Envie as duas imagens do mesmo trabalho juntas. A descrição identifica cliente, serviço ou ambiente sem expor dados pessoais.</p>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div><Label>Foto antes</Label><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setBefore(e.target.files?.[0] ?? null)} className="mt-1 block w-full text-xs text-slate-400" /></div>
          <div><Label>Foto depois</Label><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setAfter(e.target.files?.[0] ?? null)} className="mt-1 block w-full text-xs text-slate-400" /></div>
        </div>
        <div><Label htmlFor="pair-description">Descrição do serviço</Label><input id="pair-description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ex.: limpeza profunda da cozinha comercial" className="mt-1 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white" /></div>
        <button disabled={busy} className="flex items-center gap-2 rounded-xl bg-cyan-500 px-4 py-2.5 text-xs font-black text-white disabled:opacity-50">{busy ? <Loader2 size={13} className="animate-spin" /> : <Images size={13} />}Salvar par</button>
        {message && <p className="text-xs text-slate-400">{message}</p>}
      </form>
      {initialPairs.length > 0 && <p className="mt-4 text-xs font-bold text-emerald-400">{initialPairs.length} par(es) organizados e disponíveis para criação.</p>}
    </Card>
  )
}
