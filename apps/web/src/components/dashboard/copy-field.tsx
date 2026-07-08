'use client'

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'

export function CopyField({ label, value, mask = false }: { label: string; value: string; mask?: boolean }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard indisponível (http sem TLS) — usuário pode selecionar manualmente
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <p className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-500">{label}</p>
      <div
        className="flex items-center gap-2 rounded-xl px-3 py-2"
        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
      >
        <code className="min-w-0 flex-1 truncate text-xs text-slate-300">
          {mask ? `${value.slice(0, 8)}••••••••${value.slice(-4)}` : value}
        </code>
        <button
          onClick={handleCopy}
          title="Copiar"
          className="flex-shrink-0 rounded-lg p-1.5 text-slate-500 transition-all hover:bg-white/5 hover:text-slate-300"
        >
          {copied ? <Check size={13} className="text-green-400" /> : <Copy size={13} />}
        </button>
      </div>
    </div>
  )
}
