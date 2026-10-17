'use client'

import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Circle, Square, Upload, Video as VideoIcon } from 'lucide-react'
import { MAX_VIDEO_SECONDS } from '@/lib/service-orders/media'
import { AUDIO_BITS_PER_SECOND, pickRecorderMimeType, validateVideoFile, VIDEO_BITS_PER_SECOND, videoExtension } from '@/lib/service-orders/video'
import { addPendingSave, localId } from '@/lib/portal-funcionario/offline-store'
import { drainPendingSaves } from '@/lib/portal-funcionario/offline-sync'

type SavedVideo = { url: string }

function readDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const el = document.createElement('video')
    el.preload = 'metadata'
    el.onloadedmetadata = () => {
      URL.revokeObjectURL(url)
      resolve(Number.isFinite(el.duration) ? el.duration : null)
    }
    el.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(null)
    }
    el.src = url
  })
}

/**
 * Vídeos curtos da ordem (até 15s, comprimidos no aparelho a ~2 Mbps ⇒ ~4MB).
 * Sempre passam pela fila local: o vídeo é guardado no aparelho primeiro e só
 * depois enviado direto ao Storage — nunca se perde por rede/sessão. Só
 * aparece com NEXT_PUBLIC_DIRECT_MEDIA_UPLOAD=true.
 */
export function VideoSection({ unitId, appointmentId, savedVideos }: { unitId: string; appointmentId: string; savedVideos: SavedVideo[] }) {
  const router = useRouter()
  const [clip, setClip] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [recording, setRecording] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(MAX_VIDEO_SECONDS)
  const [message, setMessage] = useState<{ tone: 'ok' | 'warn' | 'error'; text: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const liveRef = useRef<HTMLVideoElement>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!clip) return setPreviewUrl(null)
    const url = URL.createObjectURL(clip)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [clip])

  useEffect(
    () => () => {
      if (timerRef.current) clearInterval(timerRef.current)
      streamRef.current?.getTracks().forEach((t) => t.stop())
    },
    [],
  )

  function stopRecording() {
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = null
    if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop()
  }

  async function startRecording() {
    setMessage(null)
    const mimeType = typeof MediaRecorder !== 'undefined' ? pickRecorderMimeType((t) => MediaRecorder.isTypeSupported(t)) : null
    if (!mimeType || !navigator.mediaDevices?.getUserMedia) {
      setMessage({ tone: 'warn', text: 'Este aparelho não grava dentro do app. Use "Escolher vídeo" (máx. 15s e 50MB).' })
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24 } },
        audio: true,
      })
      streamRef.current = stream
      if (liveRef.current) {
        liveRef.current.srcObject = stream
        void liveRef.current.play().catch(() => {})
      }
      const chunks: Blob[] = []
      const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: VIDEO_BITS_PER_SECOND, audioBitsPerSecond: AUDIO_BITS_PER_SECOND })
      recorderRef.current = recorder
      recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data)
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        streamRef.current = null
        setRecording(false)
        const baseType = mimeType.split(';')[0]!
        const file = new File(chunks, `video-${Date.now()}.${videoExtension(mimeType)}`, { type: baseType })
        const check = validateVideoFile(file, null)
        if (check.ok) setClip(file)
        else setMessage({ tone: 'error', text: check.error })
      }
      recorder.start(1000)
      setRecording(true)
      setSecondsLeft(MAX_VIDEO_SECONDS)
      const startedAt = Date.now()
      timerRef.current = setInterval(() => {
        const left = Math.max(0, MAX_VIDEO_SECONDS - Math.floor((Date.now() - startedAt) / 1000))
        setSecondsLeft(left)
        if (Date.now() - startedAt >= MAX_VIDEO_SECONDS * 1000) stopRecording() // parada dura em 15s
      }, 250)
    } catch {
      setMessage({ tone: 'error', text: 'Sem acesso à câmera. Permita a câmera ou use "Escolher vídeo".' })
    }
  }

  async function handlePick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setMessage(null)
    const check = validateVideoFile(file, await readDuration(file))
    if (check.ok) setClip(file)
    else setMessage({ tone: 'error', text: check.error })
  }

  async function save() {
    if (!clip) return
    setSaving(true)
    setMessage(null)
    const id = localId()
    // Primeiro no aparelho (nunca perde), depois envia pela fila.
    const stored = await addPendingSave({
      id,
      unitId,
      appointmentId,
      fields: {},
      files: { videos: [{ blob: clip, name: clip.name, type: clip.type }] },
    })
    if (!stored) {
      setSaving(false)
      setMessage({ tone: 'error', text: 'Não foi possível guardar o vídeo no aparelho. Tente de novo.' })
      return
    }
    setClip(null)
    const result = await drainPendingSaves({ force: true })
    setSaving(false)
    if (result.remaining === 0) {
      setMessage({ tone: 'ok', text: 'Vídeo enviado e confirmado.' })
      router.refresh()
    } else {
      setMessage({ tone: 'warn', text: 'Vídeo guardado no aparelho — envia sozinho quando a conexão voltar (veja em Sincronização).' })
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-semibold text-slate-200">Vídeos (até {MAX_VIDEO_SECONDS}s)</p>
      {savedVideos.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {savedVideos.map((v, i) => (
            <video key={i} src={v.url} controls preload="metadata" className="h-24 rounded-lg" />
          ))}
        </div>
      )}
      <video ref={liveRef} muted playsInline className={recording ? 'max-h-64 rounded-lg' : 'hidden'} />
      {recording && <p className="text-xs font-bold text-red-400">Gravando… {secondsLeft}s</p>}
      {previewUrl && !recording && <video src={previewUrl} controls playsInline className="max-h-64 rounded-lg" />}
      <div className="flex flex-wrap items-center gap-2">
        {!recording ? (
          <button type="button" onClick={startRecording} disabled={saving} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold text-red-300 disabled:opacity-50" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)' }}>
            <Circle size={13} /> Gravar vídeo
          </button>
        ) : (
          <button type="button" onClick={stopRecording} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold text-white" style={{ background: '#ef4444' }}>
            <Square size={13} /> Parar
          </button>
        )}
        <label className="flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold text-slate-200" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)' }}>
          <VideoIcon size={13} /> Escolher vídeo
          <input type="file" accept="video/*" onChange={handlePick} className="hidden" />
        </label>
        {clip && !recording && (
          <button type="button" onClick={save} disabled={saving} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold text-cyan-300 disabled:opacity-50" style={{ background: 'rgba(6,182,212,0.08)', border: '1px solid rgba(6,182,212,0.25)' }}>
            <Upload size={13} /> {saving ? 'Enviando…' : `Salvar vídeo (${(clip.size / 1048576).toFixed(1)}MB)`}
          </button>
        )}
      </div>
      {message && (
        <p className={`text-xs font-semibold ${message.tone === 'ok' ? 'text-emerald-400' : message.tone === 'warn' ? 'text-amber-400' : 'text-red-400'}`}>{message.text}</p>
      )}
    </div>
  )
}
