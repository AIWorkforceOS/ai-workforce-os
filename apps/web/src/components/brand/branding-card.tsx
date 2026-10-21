'use client'

import { useRef, useState, type ChangeEvent } from 'react'
import { useRouter } from 'next/navigation'
import { ImagePlus, Trash2 } from 'lucide-react'
import { Card } from '@/components/ui/dashboard-ui'

const ACCEPT = 'image/png,image/jpeg,image/webp'
const MAX_BYTES = 2 * 1024 * 1024

/**
 * Logo da empresa: enviar, ver como ficará e remover. A logo enviada substitui a do Alizo em todo o sistema (painéis da equipe,
 * Portal do Funcionário e Portal do Cliente). `orgId` só é usado pelo super admin Alizo (para escolher a empresa).
 */
export function BrandingCard({ currentLogoUrl, orgId, title = 'Logo da empresa', description, uploadUrl = '/api/branding/logo' }: { currentLogoUrl: string | null; orgId?: string; title?: string; description?: string; /** Endpoint de envio/remoção (padrão: logo da própria empresa; o cadastro de cliente usa o do cliente). */ uploadUrl?: string }) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  function onPick(event: ChangeEvent<HTMLInputElement>) {
    setMessage(null)
    const picked = event.target.files?.[0] ?? null
    if (!picked) return
    if (!ACCEPT.split(',').includes(picked.type)) {
      setMessage({ ok: false, text: 'Use uma imagem PNG, JPEG ou WebP.' })
      return
    }
    if (picked.size > MAX_BYTES) {
      setMessage({ ok: false, text: 'A logo deve ter no máximo 2 MB.' })
      return
    }
    if (preview) URL.revokeObjectURL(preview)
    setFile(picked)
    setPreview(URL.createObjectURL(picked))
  }

  async function save() {
    if (!file || busy) return
    setBusy(true)
    setMessage(null)
    const form = new FormData()
    form.set('file', file)
    if (orgId) form.set('orgId', orgId)
    try {
      const response = await fetch(uploadUrl, { method: 'POST', body: form })
      const data = (await response.json().catch(() => null)) as { error?: string } | null
      if (!response.ok) {
        setMessage({ ok: false, text: data?.error ?? 'Não foi possível salvar a logo.' })
      } else {
        setMessage({ ok: true, text: 'Logo atualizada. Ela já aparece em todo o sistema.' })
        setFile(null)
        setPreview(null)
        if (inputRef.current) inputRef.current.value = ''
        router.refresh()
      }
    } catch {
      setMessage({ ok: false, text: 'Sem conexão. Tente de novo.' })
    }
    setBusy(false)
  }

  async function remove() {
    if (busy || !currentLogoUrl) return
    if (!window.confirm('Remover a logo da empresa? O sistema volta a mostrar a logo do Alizo.')) return
    setBusy(true)
    setMessage(null)
    try {
      const response = await fetch(uploadUrl, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orgId }) })
      const data = (await response.json().catch(() => null)) as { error?: string } | null
      if (!response.ok) setMessage({ ok: false, text: data?.error ?? 'Não foi possível remover a logo.' })
      else {
        setMessage({ ok: true, text: 'Logo removida.' })
        router.refresh()
      }
    } catch {
      setMessage({ ok: false, text: 'Sem conexão. Tente de novo.' })
    }
    setBusy(false)
  }

  const shown = preview ?? currentLogoUrl
  return (
    <Card className="flex flex-col gap-4 p-5">
      <div>
        <h2 className="text-sm font-bold text-white">{title}</h2>
        <p className="mt-1 text-xs text-slate-400">{description ?? 'A logo que você enviar substitui a do Alizo em todo o sistema: painéis da equipe, Portal do Funcionário e Portal do Cliente. PNG, JPEG ou WebP, até 2 MB.'}</p>
      </div>
      <div className="flex min-h-[72px] items-center justify-center rounded-xl p-4" style={{ background: 'rgba(255,255,255,0.96)' }} aria-label="Pré-visualização da logo">
        {shown ? <img src={shown} alt="Logo da empresa" className="max-h-16 max-w-[240px] object-contain" /> : <span className="text-xs font-semibold text-slate-500">Sem logo própria — aparece a logo do Alizo</span>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input ref={inputRef} type="file" accept={ACCEPT} onChange={onPick} className="hidden" id="brand-logo-input" />
        <label htmlFor="brand-logo-input" className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-bold text-slate-100" style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.18)' }}>
          <ImagePlus size={15} />
          {currentLogoUrl || file ? 'Escolher outra imagem' : 'Escolher imagem'}
        </label>
        {file && (
          <button type="button" onClick={() => void save()} disabled={busy} className="rounded-xl px-4 py-2 text-sm font-bold text-white disabled:opacity-60" style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)' }}>
            {busy ? 'Salvando…' : 'Salvar logo'}
          </button>
        )}
        {currentLogoUrl && !file && (
          <button type="button" onClick={() => void remove()} disabled={busy} className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-bold text-red-300 disabled:opacity-60" style={{ border: '1px solid rgba(248,113,113,0.35)' }}>
            <Trash2 size={14} />
            Remover
          </button>
        )}
      </div>
      {message && (
        <p role={message.ok ? 'status' : 'alert'} className={`text-xs font-semibold ${message.ok ? 'text-emerald-400' : 'text-red-400'}`}>
          {message.text}
        </p>
      )}
    </Card>
  )
}
