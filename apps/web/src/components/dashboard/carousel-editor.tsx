'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowDown, ArrowUp, ImagePlus, Loader2, Trash2 } from 'lucide-react'
import { MediaLightbox } from '@/components/dashboard/media-lightbox'
import { MAX_CONTENT_SLIDES, MIN_CONTENT_SLIDES, moveSlide, type CarouselSlideInput, type StoredCarousel } from '@/lib/content/carousel'

const field = 'w-full rounded-lg bg-white/5 px-2.5 py-1.5 text-xs text-white outline-none ring-1 ring-white/10 focus:ring-cyan-400/50'

/**
 * Prévia dos slides de um carrossel (rolagem horizontal) e, enquanto o post não foi aprovado, o editor: textos, ordem, incluir/remover slide,
 * foto de fundo e chamada para ação. Salvar redesenha todos os slides com a identidade da marca.
 */
export function CarouselEditor({ postId, unitId, carousel, editable }: { postId: string; unitId: string; carousel: StoredCarousel; editable: boolean }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [cover, setCover] = useState(carousel.cover)
  const [slides, setSlides] = useState<CarouselSlideInput[]>(carousel.slides)
  const [cta, setCta] = useState(carousel.cta)
  const [busy, setBusy] = useState(false)
  const [viewer, setViewer] = useState<number | null>(null)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  async function upload(file: File): Promise<string | null> {
    const form = new FormData()
    form.set('unit_id', unitId)
    form.set('file', file)
    const res = await fetch('/api/content/carousel-background', { method: 'POST', body: form })
    const data = await res.json()
    if (!res.ok) {
      setMessage({ tone: 'error', text: data.error ?? 'Não foi possível enviar a imagem.' })
      return null
    }
    return data.url as string
  }

  async function save() {
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/content/posts/${postId}/carousel`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cover, slides, cta, hashtags: carousel.hashtags }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Não foi possível salvar.')
      setMessage({ tone: 'ok', text: 'Carrossel redesenhado.' })
      setOpen(false)
      router.refresh()
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Não foi possível salvar.' })
    } finally {
      setBusy(false)
    }
  }

  const updateSlide = (i: number, patch: Partial<CarouselSlideInput>) => setSlides(slides.map((s, idx) => (idx === i ? { ...s, ...patch } : s)))

  return (
    <div className="mt-2">
      <p className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-500">Carrossel · {carousel.slide_urls.length} slides</p>
      <div className="mt-1.5 flex gap-2 overflow-x-auto pb-1">
        {carousel.slide_urls.map((url, i) => (
          <button key={url} type="button" onClick={() => setViewer(i)} className="flex-shrink-0 cursor-zoom-in" aria-label={`Ver o slide ${i + 1} em tamanho grande`}>
            <img src={url} alt={`Slide ${i + 1}`} className="h-36 w-auto rounded-lg" style={{ border: '1px solid rgba(255,255,255,0.1)' }} />
          </button>
        ))}
      </div>
      {viewer !== null && (
        <MediaLightbox
          items={carousel.slide_urls.map((src, i) => ({ type: 'image' as const, src, alt: `Slide ${i + 1} de ${carousel.slide_urls.length}` }))}
          index={viewer}
          onIndex={setViewer}
          onClose={() => setViewer(null)}
        />
      )}

      {editable && !open && (
        <button type="button" onClick={() => setOpen(true)} className="mt-2 rounded-lg border border-white/10 px-3 py-1.5 text-[11px] font-bold text-slate-300 hover:bg-white/5">
          Editar carrossel
        </button>
      )}

      {editable && open && (
        <div className="mt-2 space-y-3 rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div className="space-y-1.5">
            <p className="text-[11px] font-bold text-slate-300">Capa</p>
            <input className={field} value={cover.title} maxLength={70} onChange={(e) => setCover({ ...cover, title: e.target.value })} aria-label="Título da capa" />
            <input className={field} value={cover.subtitle} maxLength={220} onChange={(e) => setCover({ ...cover, subtitle: e.target.value })} aria-label="Subtítulo da capa" />
          </div>

          {slides.map((slide, i) => (
            <div key={i} className="space-y-1.5 rounded-lg bg-white/[0.03] p-2">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-bold text-slate-300">Slide {i + 2}</p>
                <div className="flex items-center gap-1">
                  <button type="button" aria-label="Subir slide" disabled={i === 0} onClick={() => setSlides(moveSlide(slides, i, i - 1))} className="rounded p-1 text-slate-300 hover:bg-white/10 disabled:opacity-30"><ArrowUp size={13} /></button>
                  <button type="button" aria-label="Descer slide" disabled={i === slides.length - 1} onClick={() => setSlides(moveSlide(slides, i, i + 1))} className="rounded p-1 text-slate-300 hover:bg-white/10 disabled:opacity-30"><ArrowDown size={13} /></button>
                  <button type="button" aria-label="Remover slide" disabled={slides.length <= MIN_CONTENT_SLIDES} onClick={() => setSlides(slides.filter((_, idx) => idx !== i))} className="rounded p-1 text-red-300 hover:bg-white/10 disabled:opacity-30"><Trash2 size={13} /></button>
                </div>
              </div>
              <input className={field} value={slide.title} maxLength={70} onChange={(e) => updateSlide(i, { title: e.target.value })} aria-label={`Título do slide ${i + 2}`} />
              <textarea className={field} rows={2} value={slide.body} maxLength={220} onChange={(e) => updateSlide(i, { body: e.target.value })} aria-label={`Texto do slide ${i + 2}`} />
              <div className="flex items-center gap-2 text-[11px] text-slate-400">
                <label className="flex cursor-pointer items-center gap-1 rounded border border-white/10 px-2 py-1 hover:bg-white/5">
                  <ImagePlus size={12} /> {slide.background_url ? 'Trocar foto de fundo' : 'Foto de fundo'}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0]
                      e.target.value = ''
                      if (!file) return
                      const url = await upload(file)
                      if (url) updateSlide(i, { background_url: url })
                    }}
                  />
                </label>
                {slide.background_url && (
                  <button type="button" className="text-slate-400 underline" onClick={() => updateSlide(i, { background_url: null })}>
                    Remover foto
                  </button>
                )}
              </div>
            </div>
          ))}
          {slides.length < MAX_CONTENT_SLIDES && (
            <button type="button" onClick={() => setSlides([...slides, { title: '', body: '' }])} className="rounded-lg border border-white/10 px-3 py-1.5 text-[11px] font-bold text-slate-300 hover:bg-white/5">
              + Adicionar slide
            </button>
          )}

          <div className="space-y-1.5">
            <p className="text-[11px] font-bold text-slate-300">Fechamento (chamada para ação)</p>
            <input className={field} value={cta.title} maxLength={70} onChange={(e) => setCta({ ...cta, title: e.target.value })} aria-label="Chamada para ação" />
            <input className={field} value={cta.body} maxLength={220} onChange={(e) => setCta({ ...cta, body: e.target.value })} aria-label="Texto do fechamento" />
          </div>

          <div className="flex items-center gap-2">
            <button type="button" onClick={save} disabled={busy} className="flex items-center gap-1.5 rounded-lg bg-cyan-500 px-3 py-1.5 text-[11px] font-black text-slate-950 disabled:opacity-50">
              {busy && <Loader2 size={12} className="animate-spin" />} Salvar e redesenhar
            </button>
            <button type="button" onClick={() => setOpen(false)} disabled={busy} className="rounded-lg border border-white/10 px-3 py-1.5 text-[11px] font-bold text-slate-300 hover:bg-white/5">
              Cancelar
            </button>
          </div>
        </div>
      )}
      {message && <p className={`mt-1.5 text-[11px] ${message.tone === 'ok' ? 'text-emerald-300' : 'text-red-300'}`}>{message.text}</p>}
    </div>
  )
}
