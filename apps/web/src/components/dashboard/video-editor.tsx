'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowDown, ArrowUp, ImagePlus, Loader2, Trash2 } from 'lucide-react'
import { moveSlide } from '@/lib/content/carousel'
import { MAX_SCENES, MAX_VIDEO_SECONDS, MIN_SCENES, MIN_VIDEO_SECONDS, TRANSITIONS, videoDuration, type StoredVideo, type VideoScene } from '@/lib/content/video'

const field = 'w-full rounded-lg bg-white/5 px-2.5 py-1.5 text-xs text-white outline-none ring-1 ring-white/10 focus:ring-cyan-400/50'
const TRANSITION_LABEL: Record<string, string> = { fade: 'Fade', slideleft: 'Deslizar ←', slideright: 'Deslizar →', wipeleft: 'Cortina', dissolve: 'Dissolver', fadeblack: 'Fade preto' }

/**
 * Prévia (player) do vídeo vertical e, enquanto o post não foi aprovado, o editor: roteiro, cenas (texto, duração, transição, ordem, foto de fundo) e
 * chamada para ação. Salvar redesenha os quadros e recodifica o MP4 (pode levar até ~1 min).
 */
export function VideoEditor({ postId, unitId, video, editable }: { postId: string; unitId: string; video: StoredVideo; editable: boolean }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [script, setScript] = useState(video.script)
  const [scenes, setScenes] = useState<VideoScene[]>(video.scenes)
  const [cta, setCta] = useState(video.cta)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  const total = videoDuration({ scenes, cta })
  const outOfRange = total < MIN_VIDEO_SECONDS || total > MAX_VIDEO_SECONDS

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
      const res = await fetch(`/api/content/posts/${postId}/video`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ script, scenes, cta, hashtags: video.hashtags }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Não foi possível renderizar.')
      setMessage({ tone: 'ok', text: 'Vídeo renderizado de novo.' })
      setOpen(false)
      router.refresh()
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Não foi possível renderizar.' })
    } finally {
      setBusy(false)
    }
  }

  const update = (i: number, patch: Partial<VideoScene>) => setScenes(scenes.map((s, idx) => (idx === i ? { ...s, ...patch } : s)))

  return (
    <div className="mt-2">
      <p className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-500">
        Vídeo vertical · {video.duration} s · {video.scenes.length + 1} cenas · sem áudio
      </p>
      <video src={video.mp4_url} poster={video.poster_url} controls playsInline preload="metadata" className="mt-1.5 max-h-[420px] rounded-lg" style={{ aspectRatio: '9 / 16', border: '1px solid rgba(255,255,255,0.1)' }} />
      {video.script && <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">Roteiro: {video.script}</p>}

      {editable && !open && (
        <button type="button" onClick={() => setOpen(true)} className="mt-2 rounded-lg border border-white/10 px-3 py-1.5 text-[11px] font-bold text-slate-300 hover:bg-white/5">
          Editar vídeo
        </button>
      )}

      {editable && open && (
        <div className="mt-2 space-y-3 rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <textarea className={field} rows={3} value={script} maxLength={900} onChange={(e) => setScript(e.target.value)} aria-label="Roteiro" placeholder="Roteiro" />

          {scenes.map((scene, i) => (
            <div key={i} className="space-y-1.5 rounded-lg bg-white/[0.03] p-2">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-bold text-slate-300">{i === 0 ? 'Cena 1 (gancho)' : `Cena ${i + 1}`}</p>
                <div className="flex items-center gap-1">
                  <button type="button" aria-label="Subir cena" disabled={i === 0} onClick={() => setScenes(moveSlide(scenes, i, i - 1))} className="rounded p-1 text-slate-300 hover:bg-white/10 disabled:opacity-30"><ArrowUp size={13} /></button>
                  <button type="button" aria-label="Descer cena" disabled={i === scenes.length - 1} onClick={() => setScenes(moveSlide(scenes, i, i + 1))} className="rounded p-1 text-slate-300 hover:bg-white/10 disabled:opacity-30"><ArrowDown size={13} /></button>
                  <button type="button" aria-label="Remover cena" disabled={scenes.length <= MIN_SCENES} onClick={() => setScenes(scenes.filter((_, idx) => idx !== i))} className="rounded p-1 text-red-300 hover:bg-white/10 disabled:opacity-30"><Trash2 size={13} /></button>
                </div>
              </div>
              <input className={field} value={scene.headline} maxLength={60} onChange={(e) => update(i, { headline: e.target.value })} aria-label={`Texto principal da cena ${i + 1}`} />
              <input className={field} value={scene.text} maxLength={140} onChange={(e) => update(i, { text: e.target.value })} aria-label={`Texto de apoio da cena ${i + 1}`} />
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                <label className="flex items-center gap-1">
                  Duração
                  <select className="rounded bg-white/10 px-1.5 py-1 text-white" value={scene.seconds} onChange={(e) => update(i, { seconds: Number(e.target.value) })}>
                    {[2, 3, 4, 5, 6].map((n) => (<option key={n} value={n}>{n} s</option>))}
                  </select>
                </label>
                {i > 0 && (
                  <label className="flex items-center gap-1">
                    Transição
                    <select className="rounded bg-white/10 px-1.5 py-1 text-white" value={scene.transition} onChange={(e) => update(i, { transition: e.target.value as VideoScene['transition'] })}>
                      {TRANSITIONS.map((t) => (<option key={t} value={t}>{TRANSITION_LABEL[t]}</option>))}
                    </select>
                  </label>
                )}
                <label className="flex cursor-pointer items-center gap-1 rounded border border-white/10 px-2 py-1 hover:bg-white/5">
                  <ImagePlus size={12} /> {scene.background_url ? 'Trocar foto de fundo' : 'Foto de fundo'}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0]
                      e.target.value = ''
                      if (!file) return
                      const url = await upload(file)
                      if (url) update(i, { background_url: url })
                    }}
                  />
                </label>
                {scene.background_url && (
                  <button type="button" className="underline" onClick={() => update(i, { background_url: null })}>Remover foto</button>
                )}
              </div>
            </div>
          ))}
          {scenes.length < MAX_SCENES && (
            <button type="button" onClick={() => setScenes([...scenes, { headline: '', text: '', seconds: 4, transition: 'fade' }])} className="rounded-lg border border-white/10 px-3 py-1.5 text-[11px] font-bold text-slate-300 hover:bg-white/5">
              + Adicionar cena
            </button>
          )}

          <div className="space-y-1.5">
            <p className="text-[11px] font-bold text-slate-300">Fechamento (chamada para ação)</p>
            <input className={field} value={cta.headline} maxLength={60} onChange={(e) => setCta({ ...cta, headline: e.target.value })} aria-label="Chamada para ação" />
            <input className={field} value={cta.text} maxLength={140} onChange={(e) => setCta({ ...cta, text: e.target.value })} aria-label="Texto do fechamento" />
            <label className="flex items-center gap-1 text-[11px] text-slate-400">
              Duração
              <select className="rounded bg-white/10 px-1.5 py-1 text-white" value={cta.seconds} onChange={(e) => setCta({ ...cta, seconds: Number(e.target.value) })}>
                {[3, 4, 5].map((n) => (<option key={n} value={n}>{n} s</option>))}
              </select>
            </label>
          </div>

          <p className={`text-[11px] ${outOfRange ? 'text-amber-300' : 'text-slate-400'}`}>
            Duração total: {total} s {outOfRange ? `— precisa ficar entre ${MIN_VIDEO_SECONDS} e ${MAX_VIDEO_SECONDS} s` : ''}
          </p>
          <div className="flex items-center gap-2">
            <button type="button" onClick={save} disabled={busy || outOfRange} className="flex items-center gap-1.5 rounded-lg bg-cyan-500 px-3 py-1.5 text-[11px] font-black text-slate-950 disabled:opacity-50">
              {busy && <Loader2 size={12} className="animate-spin" />} {busy ? 'Renderizando…' : 'Salvar e renderizar'}
            </button>
            <button type="button" onClick={() => setOpen(false)} disabled={busy} className="rounded-lg border border-white/10 px-3 py-1.5 text-[11px] font-bold text-slate-300 hover:bg-white/5">Cancelar</button>
          </div>
        </div>
      )}
      {message && <p className={`mt-1.5 text-[11px] ${message.tone === 'ok' ? 'text-emerald-300' : 'text-red-300'}`}>{message.text}</p>}
    </div>
  )
}
