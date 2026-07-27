'use client'

import { useState } from 'react'
import { Input, Label } from '@/components/ui/dashboard-ui'

/** Link público de candidatura da vaga (sem login) — auditoria, gap fase 3/3. */
export function JobApplicationLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      const el = document.createElement('textarea')
      el.value = url
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="jobApplicationUrl">Link público de candidatura</Label>
      <div className="flex items-center gap-2">
        <Input id="jobApplicationUrl" readOnly value={url} className="font-mono text-xs" />
        <button
          type="button"
          onClick={handleCopy}
          className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-colors"
          style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
        >
          {copied ? 'Copiado!' : 'Copiar'}
        </button>
      </div>
      <p className="text-xs text-slate-500">
        Compartilhe este link com candidatos (redes sociais, WhatsApp, anúncio) — quem se candidatar entra
        direto no funil de triagem desta vaga, sem precisar de login.
      </p>
    </div>
  )
}
