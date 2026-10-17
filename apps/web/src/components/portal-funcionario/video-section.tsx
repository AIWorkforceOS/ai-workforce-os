'use client'

import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, CloudOff, Circle, Download, Square, Video as VideoIcon, X } from 'lucide-react'
import { MAX_VIDEO_CLIPS, MAX_VIDEO_SECONDS } from '@/lib/service-orders/media'
import { AUDIO_BITS_PER_SECOND, pickRecorderMimeType, validateVideoFile, VIDEO_BITS_PER_SECOND, videoExtension } from '@/lib/service-orders/video'
import { addPendingSave, listPendingSaves, localId } from '@/lib/portal-funcionario/offline-store'
import { drainPendingSaves } from '@/lib/portal-funcionario/offline-sync'
import { saveCopiesToDevice } from '@/lib/portal-funcionario/save-to-device'
import { cameraHelp, openCameraStream } from '@/lib/portal-funcionario/camera-access'

type SavedVideo = { url: string }
type SessionClip = { id: string; file: File; synced: boolean }

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
 * Vídeos curtos da ordem (até 15s cada, comprimidos no aparelho a ~2 Mbps ⇒ ~4MB;
 * até MAX_VIDEO_CLIPS por sessão). Cada vídeo vai PARA A FILA LOCAL assim que
 * a gravação termina — não depende de tocar em "salvar" — e a fila envia
 * direto ao Storage em segundo plano. Fechar o app no meio não perde nada.
 */
export function VideoSection({
  unitId,
  appointmentId,
  savedVideos,
  onDelete,
}: {
  unitId: string
  appointmentId: string
  savedVideos: SavedVideo[]
  onDelete?: (url: string) => void
}) {
  const router = useRouter()
  const [session, setSession] = useState<SessionClip[]>([])
  const [recording, setRecording] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(MAX_VIDEO_SECONDS)
  const [message, setMessage] = useState<{ tone: 'ok' | 'warn' | 'error'; text: string } | null>(null)
  const liveRef = useRef<HTMLVideoElement>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const countRef = useRef(0)

  useEffect(
    () => () => {
      if (timerRef.current) clearInterval(timerRef.current)
      streamRef.current?.getTracks().forEach((t) => t.stop())
    },
    [],
  )

  // Marca como enviados os vídeos desta sessão que já saíram da fila.
  useEffect(() => {
    if (session.every((clip) => clip.synced)) return
    const interval = setInterval(async () => {
      const queued = new Set((await listPendingSaves()).map((item) => item.id))
      let changed = false
      const next = session.map((clip) => {
        if (!clip.synced && !queued.has(clip.id)) {
          changed = true
          return { ...clip, synced: true }
        }
        return clip
      })
      if (changed) {
        setSession(next)
        router.refresh()
      }
    }, 3000)
    return () => clearInterval(interval)
  }, [session, router])

  async function persistClip(file: File) {
    if (countRef.current >= MAX_VIDEO_CLIPS) {
      setMessage({ tone: 'warn', text: `Máximo de ${MAX_VIDEO_CLIPS} vídeos por vez. Aguarde o envio e grave os próximos.` })
      return
    }
    const id = localId()
    const stored = await addPendingSave({ id, unitId, appointmentId, fields: {}, files: { videos: [{ blob: file, name: file.name, type: file.type }] } })
    if (!stored) {
      setMessage({ tone: 'error', text: 'Não foi possível guardar o vídeo no aparelho. Tente gravar de novo.' })
      return
    }
    countRef.current += 1
    setSession((prev) => [...prev, { id, file, synced: false }])
    setMessage({ tone: 'ok', text: 'Vídeo guardado no aparelho — enviando em segundo plano.' })
    void drainPendingSaves({ ignoreBackoff: true }).catch(() => null)
  }

  function stopRecording() {
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = null
    if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop()
  }

  async function startRecording() {
    setMessage(null)
    if (countRef.current >= MAX_VIDEO_CLIPS) {
      setMessage({ tone: 'warn', text: `Máximo de ${MAX_VIDEO_CLIPS} vídeos por vez. Aguarde o envio e grave os próximos.` })
      return
    }
    const mimeType = typeof MediaRecorder !== 'undefined' ? pickRecorderMimeType((t) => MediaRecorder.isTypeSupported(t)) : null
    if (!mimeType || !navigator.mediaDevices?.getUserMedia) {
      setMessage({ tone: 'warn', text: 'Este aparelho não grava dentro do app. Use "Escolher vídeo" (máx. 15s e 50MB cada).' })
      return
    }
    const opened = await openCameraStream({ audio: true, video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24 } } })
    if (!opened.ok) {
      setMessage({ tone: 'error', text: cameraHelp(opened.reason, navigator.userAgent) })
      return
    }
    const stream = opened.stream
    try {
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
        if (check.ok) void persistClip(file)
        else setMessage({ tone: 'error', text: check.error })
      }
      recorder.start(1000)
      setRecording(true)
      setSecondsLeft(MAX_VIDEO_SECONDS)
      const startedAt = Date.now()
      timerRef.current = setInterval(() => {
        setSecondsLeft(Math.max(0, MAX_VIDEO_SECONDS - Math.floor((Date.now() - startedAt) / 1000)))
        if (Date.now() - startedAt >= MAX_VIDEO_SECONDS * 1000) stopRecording() // parada dura em 15s
      }, 250)
    } catch {
      stream.getTracks().forEach((t) => t.stop())
      setMessage({ tone: 'error', text: 'Não foi possível iniciar a gravação. Tente de novo ou use "Escolher vídeo".' })
    }
  }

  async function handlePick(event: ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(event.target.files ?? [])
    event.target.value = ''
    setMessage(null)
    for (const file of picked) {
      const check = validateVideoFile(file, await readDuration(file))
      if (check.ok) await persistClip(file)
      else setMessage({ tone: 'error', text: `${file.name}: ${check.error}` })
    }
  }

  async function saveCopies() {
    const result = await saveCopiesToDevice(session.map((clip) => clip.file))
    if (result === 'shared') setMessage({ tone: 'ok', text: 'Escolha "Salvar vídeo" para guardar na galeria.' })
    else if (result === 'downloaded') setMessage({ tone: 'ok', text: 'Cópias baixadas no celular (pasta Downloads).' })
    else if (result === 'unsupported') setMessage({ tone: 'warn', text: 'Este aparelho não permite salvar cópia daqui.' })
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-semibold text-slate-200">
        Vídeos (até {MAX_VIDEO_SECONDS}s cada, até {MAX_VIDEO_CLIPS} por vez)
      </p>
      {savedVideos.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {savedVideos.map((v, i) => (
            <div key={i} className="relative">
              <video src={v.url} controls preload="metadata" className="h-24 rounded-lg" />
              {onDelete && (
                <button
                  type="button"
                  onClick={() => onDelete(v.url)}
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full text-white"
                  style={{ background: '#ef4444' }}
                  aria-label="Excluir vídeo"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <video ref={liveRef} muted playsInline className={recording ? 'max-h-64 rounded-lg' : 'hidden'} />
      {recording && <p className="text-xs font-bold text-red-400">Gravando… {secondsLeft}s</p>}
      {session.length > 0 && (
        <ul className="flex flex-col gap-1 text-xs">
          {session.map((clip, i) => (
            <li key={clip.id} className={`flex items-center gap-1.5 ${clip.synced ? 'text-emerald-400' : 'text-amber-300'}`}>
              {clip.synced ? <CheckCircle2 size={12} /> : <CloudOff size={12} />}
              Vídeo {i + 1} · {(clip.file.size / 1048576).toFixed(1)}MB · {clip.synced ? 'enviado' : 'guardado no aparelho, enviando…'}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {!recording ? (
          <button type="button" onClick={startRecording} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold text-red-300" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)' }}>
            <Circle size={13} /> {session.length > 0 ? 'Gravar outro vídeo' : 'Gravar vídeo'}
          </button>
        ) : (
          <button type="button" onClick={stopRecording} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold text-white" style={{ background: '#ef4444' }}>
            <Square size={13} /> Parar
          </button>
        )}
        <label className="flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold text-slate-200" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)' }}>
          <VideoIcon size={13} /> Escolher vídeo
          <input type="file" accept="video/*" multiple onChange={handlePick} className="hidden" />
        </label>
        {session.length > 0 && !recording && (
          <button type="button" onClick={saveCopies} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold text-slate-200" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)' }}>
            <Download size={13} /> Salvar cópia na galeria
          </button>
        )}
      </div>
      {message && (
        <p className={`text-xs font-semibold ${message.tone === 'ok' ? 'text-emerald-400' : message.tone === 'warn' ? 'text-amber-400' : 'text-red-400'}`}>{message.text}</p>
      )}
    </div>
  )
}
