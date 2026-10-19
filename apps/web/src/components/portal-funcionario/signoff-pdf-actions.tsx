'use client'

import { useEffect, useRef, useState } from 'react'
import { Download, Share2 } from 'lucide-react'
import { canShareFiles, downloadPdf, fetchSignOffPdf, openPdf, pdfUrl, sharePdf, type SignOffFile } from '@/lib/portal-funcionario/signoff-download'

type Phase = 'idle' | 'preparing' | 'ready' | 'done' | 'error'

function isIos(): boolean {
  if (typeof navigator === 'undefined') return false
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

/**
 * Botões "Baixar Sign Off" e "Compartilhar" na tela da ordem assinada. Funciona no Safari do iPhone, no Chrome do Android e no app instalado (PWA):
 * busca o PDF pronto pelo endpoint de sempre (mesma sessão/permissões), confere que é um PDF de verdade e entrega pela folha nativa de
 * compartilhar (Salvar em Arquivos, WhatsApp…) ou por download comum. Nada é gerado de novo nem altera o documento assinado.
 */
export function SignOffPdfActions({
  unitId,
  appointmentId,
  orderNumber,
  startsAt,
  version,
}: {
  unitId: string
  appointmentId: string
  orderNumber: string | null
  startsAt: string
  /** Muda quando a ordem muda (nova assinatura/fotos): descarta o PDF guardado em memória para nunca entregar uma versão velha. */
  version: string
}) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const [canShare, setCanShare] = useState(false)
  const [ios, setIos] = useState(false)
  const cache = useRef<{ version: string; file: SignOffFile } | null>(null)
  const busy = useRef(false)

  useEffect(() => {
    setCanShare(canShareFiles())
    setIos(isIos())
  }, [])
  useEffect(() => {
    if (cache.current && cache.current.version !== version) {
      cache.current = null
      setPhase('idle')
      setMessage(null)
    }
  }, [version])

  async function prepare(): Promise<SignOffFile | null> {
    if (cache.current && cache.current.version === version) return cache.current.file
    setPhase('preparing')
    setMessage(null)
    const result = await fetchSignOffPdf({ unitId, appointmentId, orderNumber, startsAt })
    if (!result.ok) {
      setPhase('error')
      setMessage(result.message)
      return null
    }
    cache.current = { version, file: result.value }
    return result.value
  }

  async function deliver(file: SignOffFile, mode: 'download' | 'share') {
    const wantShare = mode === 'share' || (ios && canShare)
    if (wantShare) {
      const outcome = await sharePdf(file.file)
      if (outcome === 'shared') {
        setPhase('done')
        setMessage('Escolha “Salvar em Arquivos” para guardar no iPhone, ou o WhatsApp para enviar.')
        return
      }
      if (outcome === 'cancelled') {
        setPhase('ready')
        setMessage('PDF pronto. Toque de novo para salvar ou compartilhar.')
        return
      }
      if (outcome === 'needs_tap') {
        // o PDF demorou e o Safari pede um novo toque para abrir a folha de compartilhar
        setPhase('ready')
        setMessage('PDF pronto! Toque no botão de novo para salvar em Arquivos ou enviar pelo WhatsApp.')
        return
      }
      if (mode === 'share') {
        setPhase('error')
        setMessage('Este aparelho não consegue compartilhar o arquivo. Use “Baixar Sign Off”.')
        return
      }
    }
    if (downloadPdf(file.file)) {
      setPhase('done')
      setMessage(
        ios
          ? 'Se o PDF abriu na tela, toque em Compartilhar → “Salvar em Arquivos”.'
          : 'Arquivo baixado: veja a pasta Downloads (ou a notificação do navegador).',
      )
      return
    }
    if (openPdf(file.file)) return
    setPhase('error')
    setMessage('Não foi possível baixar neste aparelho. Toque em “Abrir PDF” e salve pelo menu do navegador.')
  }

  async function run(mode: 'download' | 'share') {
    if (busy.current) return
    busy.current = true
    try {
      const file = await prepare()
      if (file) await deliver(file, mode)
    } finally {
      busy.current = false
    }
  }

  const preparing = phase === 'preparing'
  return (
    <div
      className="flex flex-col gap-2 rounded-2xl p-3"
      style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.35)' }}
      data-testid="signoff-actions"
    >
      <p className="text-xs font-bold uppercase tracking-wide text-emerald-300">Sign Off assinado</p>
      <button
        type="button"
        disabled={preparing}
        onClick={() => void run('download')}
        className="flex w-full items-center justify-center gap-2 rounded-xl px-4 py-4 text-base font-bold text-white transition-all active:scale-[0.98] disabled:opacity-60"
        style={{ background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', boxShadow: '0 4px 14px rgba(16,185,129,0.3)' }}
      >
        <Download size={18} />
        {preparing ? 'Preparando o PDF…' : 'Baixar Sign Off'}
      </button>
      {canShare && (
        <button
          type="button"
          disabled={preparing}
          onClick={() => void run('share')}
          className="flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold text-slate-100 transition-all active:scale-[0.98] disabled:opacity-60"
          style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.2)' }}
        >
          <Share2 size={16} />
          Compartilhar (WhatsApp, e-mail…)
        </button>
      )}
      {preparing && <p className="text-xs text-slate-300">Montando o PDF com a assinatura e as fotos — pode levar alguns segundos.</p>}
      {message && (
        <p className={`text-xs font-semibold ${phase === 'error' ? 'text-red-400' : 'text-emerald-300'}`} role={phase === 'error' ? 'alert' : 'status'}>
          {message}
          {phase === 'error' && (
            <button type="button" onClick={() => void run('download')} className="ml-2 underline">
              Tentar novamente
            </button>
          )}
        </p>
      )}
      <a href={pdfUrl(unitId, appointmentId)} target="_blank" rel="noreferrer" className="w-fit text-xs font-semibold text-slate-300 underline">
        Abrir PDF na tela
      </a>
      {ios && !canShare && <p className="text-xs text-slate-400">iPhone: ao abrir o PDF, toque em Compartilhar → “Salvar em Arquivos”.</p>}
    </div>
  )
}
