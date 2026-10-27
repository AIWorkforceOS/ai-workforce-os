'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Maximize2, Minus, Plus } from 'lucide-react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { clampZoom, pinchZoom, planPage, stepZoom, touchDistance } from '@/lib/portal-funcionario/pdf-view'

type PdfDocument = PDFDocumentProxy

/**
 * Páginas do PDF desenhadas no próprio app (pdf.js), no lugar do <iframe> do navegador: no iPhone o iframe mostra a página num tamanho fixo, sem zoom nem
 * "ajustar". Aqui o documento abre com a PÁGINA INTEIRA ajustada à largura da tela, rola na vertical, dá zoom (botões + − e pinça) e volta ao ajuste com um
 * toque. Se o pdf.js falhar por qualquer motivo, cai no visualizador antigo do navegador (`fallbackUrl`) — nunca deixa a pessoa sem ver o documento.
 */
export function PdfPagesView({ file, fallbackUrl }: { file: File; fallbackUrl: string }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const pagesRef = useRef<HTMLDivElement>(null)
  const [doc, setDoc] = useState<PdfDocument | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [width, setWidth] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [liveScale, setLiveScale] = useState(1) // escala visual durante a pinça (só CSS; o desenho nítido volta ao soltar)
  const pinch = useRef<{ startDistance: number; startZoom: number } | null>(null)
  const zoomRef = useRef(1)
  zoomRef.current = zoom
  const liveScaleRef = useRef(1)
  liveScaleRef.current = liveScale

  // 1) carrega o documento
  useEffect(() => {
    let cancelled = false
    let loaded: PdfDocument | null = null
    ;(async () => {
      try {
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf')
        pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/legacy/build/pdf.worker.min.js', import.meta.url).toString()
        const data = new Uint8Array(await file.arrayBuffer())
        loaded = await pdfjs.getDocument({ data }).promise
        if (cancelled) return void loaded.destroy()
        setDoc(loaded)
        setStatus('ready')
      } catch {
        if (!cancelled) setStatus('failed')
      }
    })()
    return () => {
      cancelled = true
      void loaded?.destroy()
    }
  }, [file])

  // 2) largura disponível (acompanha girar o celular e a barra do navegador)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = () => setWidth(Math.max(0, el.clientWidth - 16))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [status])

  // 3) desenha as páginas na largura da tela × zoom
  useEffect(() => {
    const container = pagesRef.current
    if (!doc || !container || width <= 0) return
    let cancelled = false
    ;(async () => {
      const built: HTMLCanvasElement[] = []
      for (let n = 1; n <= doc.numPages; n += 1) {
        if (cancelled) return
        const page = await doc.getPage(n)
        const base = page.getViewport({ scale: 1 })
        const plan = planPage({ containerWidth: width, zoom, pageWidth: base.width, pageHeight: base.height, devicePixelRatio: window.devicePixelRatio })
        const canvas = document.createElement('canvas')
        canvas.width = plan.canvasWidth
        canvas.height = plan.canvasHeight
        canvas.style.width = `${plan.cssWidth}px`
        canvas.style.height = `${plan.cssHeight}px`
        canvas.style.display = 'block'
        canvas.style.margin = '0 auto 10px'
        canvas.style.background = '#fff'
        canvas.style.boxShadow = '0 1px 6px rgba(0,0,0,0.5)'
        const context = canvas.getContext('2d')
        if (!context) continue
        await page.render({ canvasContext: context, viewport: page.getViewport({ scale: plan.scale }) }).promise
        built.push(canvas)
      }
      if (cancelled) return
      // troca tudo de uma vez: sem piscar a tela em branco a cada zoom
      container.replaceChildren(...built)
      setLiveScale(1)
    })().catch(() => {
      if (!cancelled) setStatus('failed')
    })
    return () => {
      cancelled = true
    }
  }, [doc, width, zoom])

  // 4) pinça com dois dedos (touch-action: pan-x pan-y no contêiner deixa a rolagem normal e libera a pinça para nós)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onStart = (e: TouchEvent) => {
      if (e.touches.length === 2) pinch.current = { startDistance: touchDistance(e.touches[0]!, e.touches[1]!), startZoom: zoomRef.current }
    }
    const onMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !pinch.current) return
      e.preventDefault()
      const next = pinchZoom(pinch.current.startZoom, pinch.current.startDistance, touchDistance(e.touches[0]!, e.touches[1]!))
      setLiveScale(next / pinch.current.startZoom)
    }
    const onEnd = (e: TouchEvent) => {
      if (!pinch.current || e.touches.length >= 2) return
      const finalZoom = clampZoom(pinch.current.startZoom * liveScaleRef.current)
      pinch.current = null
      setZoom(finalZoom)
    }
    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd, { passive: true })
    el.addEventListener('touchcancel', onEnd, { passive: true })
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onEnd)
    }
  }, [status])

  const fit = useCallback(() => {
    setZoom(1)
    scrollRef.current?.scrollTo({ left: 0, top: 0, behavior: 'smooth' })
  }, [])

  if (status === 'failed') {
    return (
      <>
        <iframe src={fallbackUrl} title={file.name} className="min-h-0 w-full flex-1 bg-white" />
        <p className="px-3 py-2 text-center text-[11px] text-slate-400" style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}>
          Se só a 1ª página aparecer, toque em “Salvar/Enviar” → “Salvar em Arquivos” para ter o PDF completo.
        </p>
      </>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-center gap-2 px-3 py-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <button type="button" onClick={() => setZoom((z) => stepZoom(z, -1))} aria-label="Diminuir" className="flex h-10 w-10 items-center justify-center rounded-xl text-white active:scale-95" style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)' }}>
          <Minus size={18} />
        </button>
        <button type="button" onClick={fit} className="flex h-10 items-center gap-1.5 rounded-xl px-4 text-sm font-bold text-white active:scale-95" style={{ background: 'rgba(6,182,212,0.18)', border: '1px solid rgba(6,182,212,0.45)' }}>
          <Maximize2 size={15} />
          Ajustar à tela
        </button>
        <button type="button" onClick={() => setZoom((z) => stepZoom(z, 1))} aria-label="Aumentar" className="flex h-10 w-10 items-center justify-center rounded-xl text-white active:scale-95" style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)' }}>
          <Plus size={18} />
        </button>
        <span className="w-12 text-right text-xs font-semibold tabular-nums text-slate-300" aria-live="polite">
          {Math.round(zoom * 100)}%
        </span>
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto bg-[#1b2234] p-2" style={{ touchAction: 'pan-x pan-y', WebkitOverflowScrolling: 'touch' }} data-testid="pdf-scroll">
        {status === 'loading' && <p className="py-10 text-center text-sm text-slate-300">Abrindo o documento…</p>}
        <div ref={pagesRef} style={{ transform: liveScale !== 1 ? `scale(${liveScale})` : undefined, transformOrigin: 'top center', width: 'max-content', minWidth: '100%' }} />
      </div>
    </div>
  )
}
