'use client'

import { useEffect, useRef, useState } from 'react'
import { Camera, Check, Download, X } from 'lucide-react'
import { saveCopiesToDevice } from '@/lib/portal-funcionario/save-to-device'
import { cameraHelp, openCameraStream } from '@/lib/portal-funcionario/camera-access'

const MAX_SHOTS_PER_SESSION = 40

/**
 * Câmera que NÃO fecha a cada foto: o técnico abre uma vez, toca no botão
 * redondo quantas vezes precisar (contador na tela) e só então toca em
 * "Concluir". Cada foto é entregue na hora (onShot) para o formulário
 * guardar no aparelho (rascunho/IndexedDB) — se o app fechar no meio da
 * sessão, o que já foi tirado não se perde.
 */
export function MultiShotCamera({ label, onShot }: { label: string; onShot: (file: File) => void }) {
  const [open, setOpen] = useState(false)
  const [count, setCount] = useState(0)
  const [lastThumb, setLastThumb] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copyMessage, setCopyMessage] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const sessionFiles = useRef<File[]>([])

  function stopStream() {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }

  async function openCamera() {
    setError(null)
    setCopyMessage(null)
    sessionFiles.current = []
    setCount(0)
    setLastThumb(null)
    const result = await openCameraStream({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 2560 }, height: { ideal: 1440 } } })
    if (!result.ok) {
      setError(cameraHelp(result.reason, navigator.userAgent))
      return
    }
    streamRef.current = result.stream
    setOpen(true)
  }

  // Liga o stream no <video> assim que o overlay existe.
  useEffect(() => {
    if (!open || !videoRef.current || !streamRef.current) return
    videoRef.current.srcObject = streamRef.current
    void videoRef.current.play().catch(() => {})
  }, [open])

  useEffect(() => () => stopStream(), [])
  useEffect(() => {
    return () => {
      if (lastThumb) URL.revokeObjectURL(lastThumb)
    }
  }, [lastThumb])

  function shoot() {
    const video = videoRef.current
    if (!video || !video.videoWidth || sessionFiles.current.length >= MAX_SHOTS_PER_SESSION) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height)
    canvas.toBlob(
      (blob) => {
        if (!blob) return
        const file = new File([blob], `foto-${Date.now()}-${sessionFiles.current.length + 1}.jpg`, { type: 'image/jpeg' })
        sessionFiles.current.push(file)
        onShot(file)
        setCount(sessionFiles.current.length)
        setLastThumb(URL.createObjectURL(blob))
        if (navigator.vibrate) navigator.vibrate(30)
      },
      'image/jpeg',
      0.88,
    )
  }

  function finish() {
    stopStream()
    setOpen(false)
  }

  async function saveCopy() {
    const result = await saveCopiesToDevice(sessionFiles.current)
    setCopyMessage(
      result === 'shared'
        ? 'Escolha "Salvar imagens" para guardar na galeria.'
        : result === 'downloaded'
          ? 'Cópias baixadas no celular (pasta Downloads).'
          : result === 'cancelled'
            ? null
            : 'Este aparelho não permite salvar cópia daqui.',
    )
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={openCamera}
        className="flex w-fit items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold text-cyan-200"
        style={{ background: 'rgba(6,182,212,0.15)', border: '1px solid rgba(6,182,212,0.4)' }}
      >
        <Camera size={14} /> {label}
      </button>
      {error && <p className="text-xs text-red-400">{error}</p>}

      {open && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black">
          <video ref={videoRef} playsInline muted autoPlay className="min-h-0 flex-1 object-contain" />
          <div className="flex items-center justify-between gap-3 px-5 py-4" style={{ background: 'rgba(0,0,0,0.85)' }}>
            <div className="flex w-24 items-center gap-2">
              {lastThumb && <img src={lastThumb} alt="Última foto" className="h-12 w-12 rounded-lg object-cover" />}
              <span className="rounded-full bg-cyan-500 px-2.5 py-1 text-sm font-black text-black" aria-live="polite">
                {count}
              </span>
            </div>
            <button
              type="button"
              onClick={shoot}
              aria-label="Tirar foto"
              className="h-16 w-16 rounded-full border-4 border-white bg-white/20 active:bg-white"
            />
            <div className="flex w-24 flex-col items-end gap-2">
              <button type="button" onClick={finish} className="flex items-center gap-1 rounded-lg bg-emerald-500 px-3 py-2 text-xs font-black text-black">
                <Check size={14} /> Concluir
              </button>
            </div>
          </div>
          <div className="flex items-center justify-between px-5 pb-4 text-xs" style={{ background: 'rgba(0,0,0,0.85)' }}>
            <button
              type="button"
              onClick={saveCopy}
              disabled={count === 0}
              className="flex items-center gap-1 text-slate-200 disabled:opacity-40"
            >
              <Download size={13} /> Salvar cópia na galeria
            </button>
            <button type="button" onClick={finish} className="flex items-center gap-1 text-slate-400">
              <X size={13} /> Fechar
            </button>
          </div>
          {copyMessage && <p className="bg-black/85 px-5 pb-3 text-xs text-amber-300">{copyMessage}</p>}
          {count > 0 && <p className="bg-black/85 px-5 pb-3 text-[11px] text-slate-400">As {count} fotos já estão guardadas no app. Toque em Concluir para vê-las no formulário.</p>}
        </div>
      )}
    </div>
  )
}
