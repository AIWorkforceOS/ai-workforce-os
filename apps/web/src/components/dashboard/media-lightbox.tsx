'use client'

import { useCallback, useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Play, X } from 'lucide-react'
import type { MediaItem } from '@/lib/content/media-items'

/**
 * Visualizador em tela grande: imagem inteira (sem cortar), galeria com setas/teclado para os slides de um carrossel e vídeo que abre
 * tocando (o vídeo é silencioso: já abre sem som, o que o navegador sempre deixa tocar sozinho), com controles. Fecha com o X, Esc ou clicando fora.
 */
export function MediaLightbox({ items, index, onIndex, onClose }: { items: MediaItem[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const item = items[index]
  const go = useCallback((delta: number) => onIndex((index + delta + items.length) % items.length), [index, items.length, onIndex])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight' && items.length > 1) go(1)
      else if (e.key === 'ArrowLeft' && items.length > 1) go(-1)
    }
    document.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [go, items.length, onClose])

  if (!item) return null
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-4" role="dialog" aria-modal="true" aria-label={item.alt} onClick={onClose}>
      <button type="button" onClick={onClose} aria-label="Fechar" className="absolute right-4 top-4 rounded-full bg-white/10 p-2.5 text-white hover:bg-white/20">
        <X size={20} />
      </button>
      {items.length > 1 && (
        <>
          <button type="button" aria-label="Anterior" onClick={(e) => { e.stopPropagation(); go(-1) }} className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-3 text-white hover:bg-white/20">
            <ChevronLeft size={22} />
          </button>
          <button type="button" aria-label="Próximo" onClick={(e) => { e.stopPropagation(); go(1) }} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-3 text-white hover:bg-white/20">
            <ChevronRight size={22} />
          </button>
        </>
      )}
      <div className="flex max-h-full max-w-full flex-col items-center gap-2" onClick={(e) => e.stopPropagation()}>
        {item.type === 'video' ? (
          <video key={item.src} src={item.src} poster={item.poster} controls autoPlay muted playsInline className="max-h-[88vh] max-w-[92vw] rounded-lg bg-black" />
        ) : (
          <img key={item.src} src={item.src} alt={item.alt} className="max-h-[88vh] max-w-[92vw] rounded-lg object-contain" />
        )}
        {items.length > 1 && <p className="text-xs font-bold text-slate-300">{index + 1} / {items.length}</p>}
      </div>
    </div>
  )
}

/** Miniatura clicável (card da fila de aprovação): abre o visualizador. Vídeo mostra o botão de play. */
export function MediaThumb({ items, thumbSrc, className }: { items: MediaItem[]; thumbSrc: string; className?: string }) {
  const [open, setOpen] = useState(false)
  const [index, setIndex] = useState(0)
  const first = items[0]
  return (
    <>
      <button type="button" onClick={() => { setIndex(0); setOpen(true) }} className="group relative block cursor-zoom-in" aria-label={first?.type === 'video' ? 'Assistir ao vídeo' : 'Ver em tamanho grande'}>
        <img src={thumbSrc} alt={first?.alt ?? 'Prévia do post'} className={className} style={{ border: '1px solid rgba(255,255,255,0.08)' }} />
        {first?.type === 'video' && (
          <span className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/30 transition-colors group-hover:bg-black/45">
            <span className="rounded-full bg-white/90 p-3 text-slate-900"><Play size={22} fill="currentColor" /></span>
          </span>
        )}
        {items.length > 1 && <span className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-black text-white">{items.length} slides</span>}
      </button>
      {open && <MediaLightbox items={items} index={index} onIndex={setIndex} onClose={() => setOpen(false)} />}
    </>
  )
}
