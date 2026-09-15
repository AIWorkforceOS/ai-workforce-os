'use client'

import { useState } from 'react'
import { Check, Copy, Sparkles } from 'lucide-react'
import { Label, Textarea } from '@/components/ui/dashboard-ui'

/**
 * Formato normalizado esperado pelo painel — cada chamador (Portal 360,
 * login da 360; painel do admin da unidade) adapta o shape próprio pra
 * este, já que os dois têm os mesmos dados (mesma tabela appointments)
 * só com nomes/estruturas diferentes.
 */
export type QuoteBuilderOrder = {
  id: string
  orderNumber: string | null
  locationName: string | null
  address: string | null
  materialDescription: string | null
  materialValue: number | null
  hoursNeeded: number | null
  partPurchaseLink: string | null
  photoUrls: string[]
  quoteDescriptionEn: string | null
  quoteDescriptionPt: string | null
}

const COPY: Record<
  'pt' | 'en',
  {
    notesLabel: string
    generate: string
    regenerate: string
    generating: string
    enLabel: string
    ptLabel: string
    copyButton: string
    copied: string
  }
> = {
  pt: {
    notesLabel: 'Anotação do técnico (original, português)',
    generate: 'Gerar cotação com IA',
    regenerate: 'Gerar cotação de novo',
    generating: 'Gerando…',
    enLabel: 'Cotação em inglês (isso é o que vai pro cliente final)',
    ptLabel: 'Tradução em português (só conferência — nunca vai pro cliente)',
    copyButton: 'Copiar cotação completa (texto + preço + material + fotos)',
    copied: 'Copiado — cole no seu e-mail',
  },
  en: {
    notesLabel: "Technician's notes (original, Portuguese)",
    generate: 'Generate quote with AI',
    regenerate: 'Regenerate quote with AI',
    generating: 'Generating…',
    enLabel: 'Quote description (English — this is what goes to the client)',
    ptLabel: 'Portuguese translation (internal review only — never sent to the client)',
    copyButton: 'Copy full package (quote + price + material + photos)',
    copied: 'Copied — paste it into your email',
  },
}

function formatCurrencyUsd(value: number): string {
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

/**
 * Monta o texto final pronto pra colar num e-mail particular — pedido
 * do Vinicius (2026-09-15): "vamos deixar o envio de e-mail para
 * depois, vamos criar apenas um modo dele copiar as informações e
 * colar no seu e-mail particular para envio". Junta a cotação em
 * inglês + material/valor/horas/link + URLs das fotos (o clipboard não
 * carrega imagem entre domínios de forma confiável, então as fotos
 * entram como link mesmo).
 */
function buildCopyPackage(order: QuoteBuilderOrder, quoteEn: string): string {
  const lines = [
    `Service Order${order.orderNumber ? ` #${order.orderNumber}` : ''}${order.locationName ? ` — ${order.locationName}` : ''}`,
    order.address ?? null,
    '',
    quoteEn,
    '',
    order.hoursNeeded != null ? `Estimated time: ${order.hoursNeeded}h` : null,
    order.materialValue != null ? `Estimated cost: ${formatCurrencyUsd(order.materialValue)}` : null,
    order.partPurchaseLink ? `Material reference: ${order.partPurchaseLink}` : null,
  ].filter((line): line is string => line !== null)

  if (order.photoUrls.length > 0) {
    lines.push('', 'Photos:', ...order.photoUrls)
  }

  return lines.join('\n')
}

export function QuoteBuilderPanel({
  order,
  generateUrl,
  locale = 'pt',
}: {
  order: QuoteBuilderOrder
  /** Rota que gera/regera a cotação — cada portal tem a sua própria autorização (ver as duas rotas irmãs em app/api). */
  generateUrl: string
  /** Idioma dos rótulos da tela — o CONTEÚDO gerado é sempre inglês+português, independente disso. */
  locale?: 'pt' | 'en'
}) {
  const t = COPY[locale]
  const [quoteEn, setQuoteEn] = useState(order.quoteDescriptionEn ?? '')
  const [quotePt, setQuotePt] = useState(order.quoteDescriptionPt ?? '')
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function handleGenerate() {
    setGenerating(true)
    setError(null)
    try {
      const res = await fetch(generateUrl, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Could not generate the quote.')
        return
      }
      setQuoteEn(data.quoteEn)
      setQuotePt(data.quotePt)
    } catch {
      setError('Could not generate the quote.')
    } finally {
      setGenerating(false)
    }
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(buildCopyPackage(order, quoteEn))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="flex flex-col gap-4">
      {order.materialDescription && (
        <div className="flex flex-col gap-1">
          <Label>{t.notesLabel}</Label>
          <p
            className="rounded-xl px-3.5 py-2.5 text-sm text-slate-300"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
          >
            {order.materialDescription}
          </p>
        </div>
      )}

      <button
        type="button"
        onClick={handleGenerate}
        disabled={generating || !order.materialDescription}
        className="flex w-fit items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold text-white transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
        style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)' }}
      >
        <Sparkles size={13} />
        {generating ? t.generating : quoteEn ? t.regenerate : t.generate}
      </button>
      {error && <p className="text-xs text-red-400">{error}</p>}

      {quoteEn && (
        <div className="flex flex-col gap-1.5">
          <Label>{t.enLabel}</Label>
          <Textarea rows={6} value={quoteEn} onChange={(e) => setQuoteEn(e.target.value)} />
        </div>
      )}

      {quotePt && (
        <div className="flex flex-col gap-1">
          <Label>{t.ptLabel}</Label>
          <p
            className="whitespace-pre-wrap rounded-xl px-3.5 py-2.5 text-sm text-slate-400"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
          >
            {quotePt}
          </p>
        </div>
      )}

      {quoteEn && (
        <button
          type="button"
          onClick={handleCopy}
          className="flex w-fit items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold text-slate-200 transition-colors hover:text-white"
          style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)' }}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? t.copied : t.copyButton}
        </button>
      )}
    </div>
  )
}
