'use client'

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Eraser, X } from 'lucide-react'

/**
 * Canvas de assinatura por toque — desenho livre com Pointer Events
 * (funciona com dedo no celular e mouse no desktop). Sem lib externa:
 * simples o bastante pra não justificar uma dependência nova. Usado
 * pelo técnico pra passar o celular e o GERENTE DA LOJA assinar.
 */
export function SignaturePad({ onSave, onCancel }: { onSave: (dataUrl: string) => void; onCancel: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawingRef = useRef(false)
  const lastPointRef = useRef<{ x: number; y: number } | null>(null)
  const [isEmpty, setIsEmpty] = useState(true)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    // Resolução real (devicePixelRatio) pra não ficar borrado em telas retina.
    const ratio = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * ratio
    canvas.height = rect.height * ratio
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(ratio, ratio)
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#0f172a'
  }, [])

  function getPoint(event: ReactPointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    event.currentTarget.setPointerCapture(event.pointerId)
    drawingRef.current = true
    lastPointRef.current = getPoint(event)
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx || !lastPointRef.current) return
    const point = getPoint(event)
    ctx.beginPath()
    ctx.moveTo(lastPointRef.current.x, lastPointRef.current.y)
    ctx.lineTo(point.x, point.y)
    ctx.stroke()
    lastPointRef.current = point
    setIsEmpty(false)
  }

  function handlePointerUp() {
    drawingRef.current = false
    lastPointRef.current = null
  }

  function handleClear() {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    setIsEmpty(true)
  }

  function handleSave() {
    const canvas = canvasRef.current
    if (!canvas || isEmpty) return
    onSave(canvas.toDataURL('image/png'))
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: '#0a0f1e' }}>
      <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <p className="text-sm font-bold text-white">Assinatura do gerente</p>
        <button type="button" onClick={onCancel} className="text-slate-400 hover:text-slate-200">
          <X size={18} />
        </button>
      </div>
      <p className="px-4 pt-3 text-xs text-slate-400">Passe o celular para o gerente da loja assinar com o dedo abaixo.</p>
      <div className="flex-1 p-4">
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          className="h-full w-full rounded-2xl"
          style={{ background: '#fff', touchAction: 'none' }}
        />
      </div>
      <div className="flex gap-3 px-4 py-3" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
        <button
          type="button"
          onClick={handleClear}
          className="flex items-center gap-1.5 rounded-xl px-4 py-3 text-sm font-bold text-slate-300"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
        >
          <Eraser size={15} />
          Limpar
        </button>
        <button
          type="button"
          disabled={isEmpty}
          onClick={handleSave}
          className="flex-1 rounded-xl px-4 py-3 text-sm font-bold text-white transition-all active:scale-[0.98] disabled:opacity-40"
          style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)' }}
        >
          Confirmar assinatura
        </button>
      </div>
    </div>
  )
}
