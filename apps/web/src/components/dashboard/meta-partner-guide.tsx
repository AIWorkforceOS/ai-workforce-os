'use client'

// Bloco reutilizado nos fluxos self-service de Meta Ads e Facebook/Instagram
// (traffic-connect-form.tsx e content-connect-form.tsx): mostra o ID do
// Business Manager da Alizo (copiável) e o passo a passo pra o cliente
// compartilhar a conta de anúncio ou a Página como Parceiro, sem precisar
// gerar nenhum token. Degrada graciosamente quando META_BUSINESS_MANAGER_ID
// ainda não está configurado (ver lib/integrations.ts).

import { useState } from 'react'
import { Copy, Check, AlertTriangle } from 'lucide-react'

export function MetaPartnerGuide({
  businessManagerId,
  assetLabel,
  steps,
}: {
  businessManagerId: string | null
  assetLabel: string
  steps: string[]
}) {
  const [copied, setCopied] = useState(false)

  if (!businessManagerId) {
    return (
      <div
        className="flex items-start gap-2 rounded-xl p-3.5 text-xs text-amber-300"
        style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)' }}
      >
        <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
        <span>
          Integração ainda não disponível: falta o time Alizo configurar o Business Manager
          (env META_BUSINESS_MANAGER_ID). Enquanto isso, use o campo avançado abaixo com um token próprio, se tiver um.
        </span>
      </div>
    )
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(businessManagerId as string)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="flex flex-col gap-2.5 rounded-xl p-3.5" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
      <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">
        Compartilhe {assetLabel} com a Alizo — sem gerar token
      </p>
      <div className="flex items-center gap-2">
        <code className="flex-1 truncate rounded-lg px-2.5 py-1.5 text-xs text-slate-200" style={{ background: 'rgba(0,0,0,0.25)' }}>
          {businessManagerId}
        </code>
        <button
          type="button"
          onClick={handleCopy}
          className="flex flex-shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-bold text-slate-300 transition-colors hover:text-white"
          style={{ background: 'rgba(255,255,255,0.06)' }}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? 'Copiado' : 'Copiar'}
        </button>
      </div>
      <ol className="list-decimal space-y-1 pl-4 text-[11px] leading-relaxed text-slate-400">
        {steps.map((step, index) => (
          <li key={index}>{step}</li>
        ))}
      </ol>
    </div>
  )
}
