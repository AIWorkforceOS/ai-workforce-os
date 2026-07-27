import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib'
import type { Customer, Invoice, Unit } from '@/lib/types'

/**
 * Gerador de PDF da fatura (migration 048) — anexado ao e-mail em
 * api/units/[id]/invoices/[invoiceId]/send/route.ts. pdf-lib em vez de
 * puppeteer/playwright: puro JS, sem browser headless, roda bem numa
 * função serverless da Vercel.
 */

const PAGE_WIDTH = 612 // Letter (pt) — mercado dos EUA também é atendido
const PAGE_HEIGHT = 792
const MARGIN = 56
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2

type PdfLocale = 'pt' | 'en'

const COPY: Record<
  PdfLocale,
  {
    invoiceTitle: string
    from: string
    to: string
    issueDate: string
    dueDate: string
    description: string
    amount: string
    total: string
    includes: string
    payment: string
  }
> = {
  pt: {
    invoiceTitle: 'FATURA',
    from: 'De',
    to: 'Para',
    issueDate: 'Data',
    dueDate: 'Vencimento',
    description: 'Descrição',
    amount: 'Valor',
    total: 'Total',
    includes: 'Itens inclusos',
    payment: 'Como pagar',
  },
  en: {
    invoiceTitle: 'INVOICE',
    from: 'From',
    to: 'Bill to',
    issueDate: 'Date',
    dueDate: 'Due date',
    description: 'Description',
    amount: 'Amount',
    total: 'Total',
    includes: 'Includes',
    payment: 'Payment instructions',
  },
}

const DARK = rgb(0.06, 0.09, 0.16)
const MUTED = rgb(0.4, 0.46, 0.55)
const LINE = rgb(0.85, 0.87, 0.9)

const LOGO_MAX_WIDTH = 100
const LOGO_MAX_HEIGHT = 50

/** Best-effort: baixa e embute a logo da unidade. Qualquer falha (URL não-PNG/JPG, fetch, embed) apenas pula a logo — não pode derrubar a geração do resto da fatura. */
async function tryEmbedLogo(
  doc: PDFDocument,
  logoUrl: string | null,
): Promise<{ image: PDFImage; width: number; height: number } | null> {
  if (!logoUrl) return null
  try {
    const res = await fetch(logoUrl)
    if (!res.ok) return null
    const bytes = await res.arrayBuffer()
    const lower = logoUrl.toLowerCase()
    const image = lower.endsWith('.png')
      ? await doc.embedPng(bytes)
      : lower.endsWith('.jpg') || lower.endsWith('.jpeg')
        ? await doc.embedJpg(bytes)
        : null
    if (!image) return null
    const scale = Math.min(LOGO_MAX_WIDTH / image.width, LOGO_MAX_HEIGHT / image.height, 1)
    return { image, width: image.width * scale, height: image.height * scale }
  } catch {
    return null
  }
}

/** Quebra uma linha de texto em várias que cabem em maxWidth, medindo com a fonte real (pdf-lib não quebra sozinho). */
function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length === 0) return ['']
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const attempt = current ? `${current} ${word}` : word
    if (current && font.widthOfTextAtSize(attempt, size) > maxWidth) {
      lines.push(current)
      current = word
    } else {
      current = attempt
    }
  }
  if (current) lines.push(current)
  return lines
}

export async function generateInvoicePdf(params: {
  invoice: Pick<
    Invoice,
    'invoice_number' | 'description' | 'amount' | 'currency' | 'due_date' | 'created_at' | 'consolidated_items'
  >
  customer: Pick<Customer, 'name' | 'email' | 'phone' | 'address'>
  unit: Pick<
    Unit,
    | 'name'
    | 'billing_company_name'
    | 'billing_address'
    | 'billing_email'
    | 'billing_phone'
    | 'billing_payment_instructions'
    | 'logo_url'
  >
  locale?: PdfLocale
}): Promise<Buffer> {
  const locale = params.locale ?? 'pt'
  const t = COPY[locale]
  const intlLocale = locale === 'en' ? 'en-US' : 'pt-BR'

  const doc = await PDFDocument.create()
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)

  const logo = await tryEmbedLogo(doc, params.unit.logo_url)
  if (logo) {
    page.drawImage(logo.image, {
      x: PAGE_WIDTH - MARGIN - logo.width,
      y: PAGE_HEIGHT - 56 - logo.height,
      width: logo.width,
      height: logo.height,
    })
  }

  let y = PAGE_HEIGHT - 64

  function draw(
    text: string,
    opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; gap?: number } = {},
  ) {
    const size = opts.size ?? 11
    page.drawText(text, {
      x: MARGIN,
      y,
      size,
      font: opts.bold ? bold : font,
      color: opts.color ?? DARK,
    })
    y -= opts.gap ?? size + 6
  }

  function drawWrapped(text: string, opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb> } = {}) {
    const size = opts.size ?? 11
    for (const line of wrapText(text, opts.bold ? bold : font, size, CONTENT_WIDTH)) {
      draw(line, { ...opts, size })
    }
  }

  function drawSeparator(target: PDFPage) {
    target.drawLine({
      start: { x: MARGIN, y },
      end: { x: MARGIN + CONTENT_WIDTH, y },
      thickness: 1,
      color: LINE,
    })
    y -= 24
  }

  const companyName = params.unit.billing_company_name?.trim() || params.unit.name

  draw(`${t.invoiceTitle} ${params.invoice.invoice_number}`, { size: 22, bold: true, gap: 36 })

  draw(t.from, { size: 9, color: MUTED, gap: 14 })
  draw(companyName, { bold: true })
  if (params.unit.billing_address) drawWrapped(params.unit.billing_address)
  if (params.unit.billing_email) draw(params.unit.billing_email)
  if (params.unit.billing_phone) draw(params.unit.billing_phone)
  y -= 12

  draw(t.to, { size: 9, color: MUTED, gap: 14 })
  draw(params.customer.name, { bold: true })
  if (params.customer.address) drawWrapped(params.customer.address)
  if (params.customer.email) draw(params.customer.email)
  if (params.customer.phone) draw(params.customer.phone)
  y -= 12

  drawSeparator(page)

  const amountLabel = Number(params.invoice.amount).toLocaleString(intlLocale, {
    style: 'currency',
    currency: params.invoice.currency,
  })
  const dueLabel = params.invoice.due_date
    ? new Date(`${params.invoice.due_date}T00:00:00`).toLocaleDateString(intlLocale)
    : '—'
  const issueLabel = new Date(params.invoice.created_at).toLocaleDateString(intlLocale)

  draw(`${t.issueDate}: ${issueLabel}`)
  draw(`${t.dueDate}: ${dueLabel}`, { gap: 16 })
  drawWrapped(`${t.description}: ${params.invoice.description}`)
  y -= 8

  if (params.invoice.consolidated_items && params.invoice.consolidated_items.length > 0) {
    draw(t.includes, { bold: true, size: 10, color: MUTED, gap: 16 })
    for (const item of params.invoice.consolidated_items) {
      const itemAmount = Number(item.amount).toLocaleString(intlLocale, {
        style: 'currency',
        currency: params.invoice.currency,
      })
      drawWrapped(`${item.description} — ${itemAmount}`, { size: 10 })
    }
    y -= 8
  }

  drawSeparator(page)

  draw(`${t.total}: ${amountLabel}`, { size: 18, bold: true, gap: 32 })

  if (params.unit.billing_payment_instructions) {
    draw(t.payment, { bold: true, size: 10, color: MUTED, gap: 16 })
    for (const line of params.unit.billing_payment_instructions.split(/\n+/)) {
      drawWrapped(line, { size: 10 })
    }
  }

  const bytes = await doc.save()
  return Buffer.from(bytes)
}
