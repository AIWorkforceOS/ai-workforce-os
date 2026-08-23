'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, ImagePlus, Loader2, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardHeader, Label, brandGradient } from '@/components/ui/dashboard-ui'

// Identidade visual da marca (logo + paleta), pedido do Vinicius 2026-08-23:
// o Gestor de Conteúdo usa isso pra manter consistência visual nos posts
// gerados (cor sugerida no prompt da imagem, logo colado de verdade em
// cima — ver lib/content/generator.ts). Fica em
// organizations.business_profile.brand_kit (ficha compartilhada, vale pra
// todos os funcionários digitais da org, não só o de Conteúdo).

export type BrandKitValue = { logo_url: string | null; primary_color: string | null; secondary_color: string | null }

const FILE_MAX_BYTES = 5 * 1024 * 1024
const DEFAULT_COLOR = '#0EA5E9'

export function BrandKitForm({ unitId, initial }: { unitId: string; initial: BrandKitValue | null }) {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [logoUrl, setLogoUrl] = useState(initial?.logo_url ?? null)
  const [primaryColor, setPrimaryColor] = useState(initial?.primary_color ?? DEFAULT_COLOR)
  const [secondaryColor, setSecondaryColor] = useState(initial?.secondary_color ?? DEFAULT_COLOR)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  async function handleFileChange(file: File | null) {
    if (!file) return
    setError(null)
    if (file.size > FILE_MAX_BYTES) {
      setError('Logo muito grande — envie um arquivo de até 5MB.')
      return
    }
    setUploading(true)
    const supabase = createClient()
    const path = `${unitId}/brand/logo-${Date.now()}-${file.name}`
    const { error: uploadError } = await supabase.storage.from('content-media').upload(path, file, { contentType: file.type })
    setUploading(false)
    if (uploadError) {
      setError('Não foi possível enviar o logo. Tente de novo.')
      return
    }
    const { data } = supabase.storage.from('content-media').getPublicUrl(path)
    setLogoUrl(data.publicUrl)
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const response = await fetch('/api/content/brand-kit', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unit_id: unitId, logo_url: logoUrl, primary_color: primaryColor, secondary_color: secondaryColor }),
      })
      const data = (await response.json()) as { error?: string }
      if (!response.ok) {
        setError(data.error ?? 'Não foi possível salvar a identidade visual.')
        return
      }
      setSuccess('Identidade visual salva — os próximos posts já usam essa marca.')
      router.refresh()
    } catch {
      setError('Erro de rede ao salvar. Tente de novo.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="p-6">
      <CardHeader eyebrow="identidade visual" title="Logo e cores da marca" />
      <p className="mb-4 text-xs leading-relaxed text-slate-400">
        Opcional, mas recomendado: o Gestor de Conteúdo usa o logo e as cores aqui pra manter a identidade visual
        consistente em todo post gerado, em vez de um visual genérico e diferente a cada vez.
      </p>

      <div className="flex flex-col gap-4">
        <div>
          <Label>Logo</Label>
          <div className="mt-1.5 flex items-center gap-3">
            <div
              className="flex h-16 w-16 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl"
              style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)' }}
            >
              {logoUrl ? (
                <img src={logoUrl} alt="Logo da marca" className="h-full w-full object-contain p-1.5" />
              ) : (
                <ImagePlus size={18} className="text-slate-600" />
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold text-slate-300 hover:bg-white/5 disabled:opacity-60"
                style={{ border: '1px solid rgba(255,255,255,0.08)' }}
              >
                {uploading && <Loader2 size={12} className="animate-spin" />}
                {uploading ? 'Enviando...' : logoUrl ? 'Trocar logo' : 'Enviar logo'}
              </button>
              {logoUrl && (
                <button
                  type="button"
                  onClick={() => setLogoUrl(null)}
                  className="flex items-center gap-1 self-start text-[11px] font-semibold text-slate-500 hover:text-slate-300"
                >
                  <X size={11} /> Remover logo
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="brand-primary-color">Cor primária</Label>
            <div className="mt-1.5 flex items-center gap-2">
              <input
                id="brand-primary-color"
                type="color"
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                className="h-9 w-12 cursor-pointer rounded-lg"
                style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'transparent' }}
              />
              <span className="text-xs font-mono text-slate-400">{primaryColor}</span>
            </div>
          </div>
          <div>
            <Label htmlFor="brand-secondary-color">Cor secundária</Label>
            <div className="mt-1.5 flex items-center gap-2">
              <input
                id="brand-secondary-color"
                type="color"
                value={secondaryColor}
                onChange={(e) => setSecondaryColor(e.target.value)}
                className="h-9 w-12 cursor-pointer rounded-lg"
                style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'transparent' }}
              />
              <span className="text-xs font-mono text-slate-400">{secondaryColor}</span>
            </div>
          </div>
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}
        {success && (
          <p className="flex items-center gap-1.5 text-xs text-emerald-400">
            <CheckCircle2 size={13} /> {success}
          </p>
        )}

        <button
          onClick={handleSave}
          disabled={saving || uploading}
          className="flex items-center justify-center gap-2 self-start rounded-xl px-5 py-2.5 text-sm font-black text-white disabled:opacity-60"
          style={{ background: brandGradient, boxShadow: '0 4px 12px rgba(6,182,212,0.3)' }}
        >
          {saving && <Loader2 size={14} className="animate-spin" />}
          {saving ? 'Salvando...' : 'Salvar identidade visual'}
        </button>
      </div>
    </Card>
  )
}
