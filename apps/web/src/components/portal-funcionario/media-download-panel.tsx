'use client'

import { useState } from 'react'
import { Download, Images, Loader2 } from 'lucide-react'
import type { PortalServiceOrderPhoto } from '@/lib/portal-funcionario/data'
import { mediaDownloadNames } from '@/lib/portal-funcionario/media-files'
import { buildZip, uniqueNames } from '@/lib/portal-funcionario/zip'
import { saveCopiesToDevice } from '@/lib/portal-funcionario/save-to-device'

type Stage = 'idle' | 'loading' | 'ready' | 'error'

const MIME_BY_EXT: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime' }

/**
 * Baixar TODAS as fotos e vídeos da ordem: ZIP (computador, e-mail) e, no celular,
 * "Salvar na galeria" pela folha de compartilhar. Primeiro carrega os arquivos
 * (progresso na tela) e só depois mostra os botões — assim o toque que abre a
 * folha de compartilhar é recente (exigência do iPhone). Tudo acontece no
 * aparelho: nada passa pelo limite de resposta do servidor.
 */
const COPY = {
  pt: {
    all: (n: number) => `Baixar todas as fotos e vídeos (${n})`,
    loading: (i: number, n: number) => `Carregando ${i} de ${n}…`,
    zip: (n: number) => `Baixar tudo em ZIP (${n})`,
    gallery: 'Salvar na galeria do celular',
    zipDone: 'ZIP baixado.',
    shared: 'Escolha "Salvar imagens" / "Salvar vídeo" para guardar na galeria.',
    downloaded: 'Arquivos baixados (pasta Downloads do celular).',
    unsupported: 'Este aparelho não permite salvar na galeria daqui. Use o ZIP.',
    error: 'Não foi possível carregar todos os arquivos. Verifique a internet e tente de novo.',
  },
  en: {
    all: (n: number) => `Download all photos & videos (${n})`,
    loading: (i: number, n: number) => `Loading ${i} of ${n}…`,
    zip: (n: number) => `Download everything as ZIP (${n})`,
    gallery: 'Save to phone gallery',
    zipDone: 'ZIP downloaded.',
    shared: 'Choose "Save Image" / "Save Video" to keep them in your gallery.',
    downloaded: 'Files downloaded to your device.',
    unsupported: 'This device cannot save to the gallery from here. Use the ZIP.',
    error: 'Could not load all the files. Check your connection and try again.',
  },
}

export function MediaDownloadPanel({ media, orderNumber, locale = 'pt' }: { media: PortalServiceOrderPhoto[]; orderNumber: string | null; locale?: 'pt' | 'en' }) {
  const t = COPY[locale]
  const [stage, setStage] = useState<Stage>('idle')
  const [progress, setProgress] = useState(0)
  const [files, setFiles] = useState<File[]>([])
  const [note, setNote] = useState<string | null>(null)
  if (media.length === 0) return null

  async function load() {
    setStage('loading')
    setNote(null)
    setProgress(0)
    const names = uniqueNames(mediaDownloadNames(media, orderNumber))
    const out: File[] = []
    try {
      for (const [i, item] of media.entries()) {
        const res = await fetch(item.url)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const blob = await res.blob()
        const ext = (names[i]!.split('.').pop() ?? '').toLowerCase()
        out.push(new File([blob], names[i]!, { type: blob.type || MIME_BY_EXT[ext] || 'application/octet-stream' }))
        setProgress(i + 1)
      }
      setFiles(out)
      setStage('ready')
    } catch {
      setStage('error')
      setNote(t.error)
    }
  }

  async function downloadZip() {
    const entries = await Promise.all(files.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) })))
    const zip = buildZip(entries)
    const url = URL.createObjectURL(new Blob([zip as BlobPart], { type: 'application/zip' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${locale === 'en' ? 'photos-and-videos' : 'fotos-e-videos'}-${(orderNumber ?? 'ordem').replace(/[^a-zA-Z0-9.\-_]/g, '_')}.zip`
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 30_000)
    setNote(t.zipDone)
  }

  async function saveToGallery() {
    const result = await saveCopiesToDevice(files)
    if (result === 'shared') setNote(t.shared)
    else if (result === 'downloaded') setNote(t.downloaded)
    else if (result === 'unsupported') setNote(t.unsupported)
  }

  const btn = 'flex w-fit items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold text-slate-200 transition-colors hover:text-white disabled:opacity-60'
  const btnStyle = { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)' }

  return (
    <div className="flex flex-col gap-2">
      {stage !== 'ready' && (
        <button type="button" onClick={load} disabled={stage === 'loading'} className={btn} style={btnStyle}>
          {stage === 'loading' ? <Loader2 size={13} className="animate-spin" /> : <Images size={13} />}
          {stage === 'loading' ? t.loading(progress, media.length) : t.all(media.length)}
        </button>
      )}
      {stage === 'ready' && (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={downloadZip} className={btn} style={btnStyle}>
            <Download size={13} /> {t.zip(files.length)}
          </button>
          <button type="button" onClick={saveToGallery} className={btn} style={btnStyle}>
            <Images size={13} /> {t.gallery}
          </button>
        </div>
      )}
      {note && <p className="text-xs text-amber-300">{note}</p>}
    </div>
  )
}
