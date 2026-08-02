import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage } from 'pdf-lib'
import type { Customer, ConsolidatedInvoiceItem, Invoice, Unit } from '@/lib/types'

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
const BOX_FILL = rgb(0.96, 0.97, 0.98)

// Identidade visual padrão da Alizo (mesma usada na UI do dashboard) — não é
// configurável por unidade, é o tema de todas as faturas.
const BRAND_START = rgb(6 / 255, 182 / 255, 212 / 255) // #06b6d4 ciano
const BRAND_END = rgb(67 / 255, 97 / 255, 238 / 255) // #4361ee azul/índigo

const LOGO_MAX_WIDTH = 170
const LOGO_MAX_HEIGHT = 90

const TOP_BAR_HEIGHT = 8

const GRID_COLS = 3
const GRID_ROW_HEIGHT = 14
const GRID_FONT_SIZE = 8.5
const GRID_CELL_PADDING = 8

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

/** Trunca uma linha de texto com reticências até caber em maxWidth — usado na grade de itens, onde a célula tem largura fixa e não pode quebrar em várias linhas. */
function truncateText(text: string, font: PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text
  const ellipsis = '…'
  let lo = 0
  let hi = text.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    const candidate = text.slice(0, mid) + ellipsis
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      lo = mid
    } else {
      hi = mid - 1
    }
  }
  return lo === 0 ? ellipsis : text.slice(0, lo) + ellipsis
}

function brandColorAt(t: number) {
  const lerp = (a: number, b: number) => a + (b - a) * t
  return rgb(
    lerp(BRAND_START.red, BRAND_END.red),
    lerp(BRAND_START.green, BRAND_END.green),
    lerp(BRAND_START.blue, BRAND_END.blue),
  )
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
  let page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)

  const logo = await tryEmbedLogo(doc, params.unit.logo_url)

  function drawGradientBar(target: typeof page, x: number, barY: number, width: number, height: number) {
    const steps = 60
    const stepWidth = width / steps
    for (let i = 0; i < steps; i++) {
      target.drawRectangle({
        x: x + i * stepWidth,
        y: barY,
        width: stepWidth + 0.5,
        height,
        color: brandColorAt(i / (steps - 1)),
      })
    }
  }

  function startPage(): number {
    drawGradientBar(page, 0, PAGE_HEIGHT - TOP_BAR_HEIGHT, PAGE_WIDTH, TOP_BAR_HEIGHT)
    return PAGE_HEIGHT - TOP_BAR_HEIGHT - 40
  }

  let y = startPage()

  // Cabeçalho: logo proeminente no canto superior esquerdo, com o título e
  // número da fatura ao lado (ou abaixo, se não houver logo).
  const headerTop = y
  const headerHeight = Math.max(logo?.height ?? 0, 50)
  if (logo) {
    page.drawImage(logo.image, { x: MARGIN, y: headerTop - logo.height, width: logo.width, height: logo.height })
  }
  const titleX = logo ? MARGIN + logo.width + 20 : MARGIN
  const titleY = logo ? headerTop - logo.height / 2 + 8 : headerTop - 6
  page.drawText(t.invoiceTitle, { x: titleX, y: titleY, size: 22, font: bold, color: DARK })
  page.drawText(params.invoice.invoice_number, { x: titleX, y: titleY - 20, size: 13, font, color: MUTED })
  y = headerTop - headerHeight - 30

  function drawSeparator() {
    page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + CONTENT_WIDTH, y }, thickness: 1, color: LINE })
    y -= 24
  }

  type BlockLine = { text: string; size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; gapAfter?: number }

  function renderBlock(x: number, startY: number, width: number, entries: BlockLine[]): number {
    let cy = startY
    for (const entry of entries) {
      const size = entry.size ?? 11
      const f = entry.bold ? bold : font
      for (const line of wrapText(entry.text, f, size, width)) {
        page.drawText(line, { x, y: cy, size, font: f, color: entry.color ?? DARK })
        cy -= size + 4
      }
      cy -= entry.gapAfter ?? 2
    }
    return cy
  }

  const companyName = params.unit.billing_company_name?.trim() || params.unit.name

  // Blocos "De" / "Para" lado a lado, em duas colunas.
  const columnGutter = 24
  const columnWidth = (CONTENT_WIDTH - columnGutter) / 2

  const fromEntries: BlockLine[] = [
    { text: t.from, size: 9, color: MUTED, gapAfter: 6 },
    { text: companyName, bold: true },
  ]
  if (params.unit.billing_address) fromEntries.push({ text: params.unit.billing_address, size: 10 })
  if (params.unit.billing_email) fromEntries.push({ text: params.unit.billing_email, size: 10 })
  if (params.unit.billing_phone) fromEntries.push({ text: params.unit.billing_phone, size: 10 })

  const toEntries: BlockLine[] = [
    { text: t.to, size: 9, color: MUTED, gapAfter: 6 },
    { text: params.customer.name, bold: true },
  ]
  if (params.customer.address) toEntries.push({ text: params.customer.address, size: 10 })
  if (params.customer.email) toEntries.push({ text: params.customer.email, size: 10 })
  if (params.customer.phone) toEntries.push({ text: params.customer.phone, size: 10 })

  const blockStartY = y
  const leftEndY = renderBlock(MARGIN, blockStartY, columnWidth, fromEntries)
  const rightEndY = renderBlock(MARGIN + columnWidth + columnGutter, blockStartY, columnWidth, toEntries)
  y = Math.min(leftEndY, rightEndY) - 12

  drawSeparator()

  const amountLabel = Number(params.invoice.amount).toLocaleString(intlLocale, {
    style: 'currency',
    currency: params.invoice.currency,
  })
  const dueLabel = params.invoice.due_date
    ? new Date(`${params.invoice.due_date}T00:00:00`).toLocaleDateString(intlLocale)
    : '—'
  const issueLabel = new Date(params.invoice.created_at).toLocaleDateString(intlLocale)

  y = renderBlock(MARGIN, y, CONTENT_WIDTH, [
    { text: `${t.issueDate}: ${issueLabel}`, gapAfter: 0 },
    { text: `${t.dueDate}: ${dueLabel}`, gapAfter: 10 },
    { text: `${t.description}: ${params.invoice.description}` },
  ])
  y -= 8

  // Grade de itens em 3 colunas (row-major), compacta o bastante pra caber
  // ~50 lançamentos numa página só, com quebra de página como rede de
  // segurança para consolidações ainda maiores.
  const items: ConsolidatedInvoiceItem[] = params.invoice.consolidated_items ?? []
  if (items.length > 0) {
    page.drawText(t.includes, { x: MARGIN, y, size: 10, font: bold, color: MUTED })
    y -= 16

    const colWidth = CONTENT_WIDTH / GRID_COLS
    for (let i = 0; i < items.length; i++) {
      const col = i % GRID_COLS
      if (col === 0 && y < MARGIN + GRID_ROW_HEIGHT) {
        page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
        y = startPage()
      }
      const item = items[i]!
      const itemAmount = Number(item.amount).toLocaleString(intlLocale, {
        style: 'currency',
        currency: params.invoice.currency,
      })
      const cellText = truncateText(
        `${item.description} — ${itemAmount}`,
        font,
        GRID_FONT_SIZE,
        colWidth - GRID_CELL_PADDING,
      )
      page.drawText(cellText, { x: MARGIN + col * colWidth, y, size: GRID_FONT_SIZE, font, color: DARK })
      if (col === GRID_COLS - 1) y -= GRID_ROW_HEIGHT
    }
    if (items.length % GRID_COLS !== 0) y -= GRID_ROW_HEIGHT
    y -= 12
  }

  drawSeparator()

  // Caixa destacada do total, com tom claro da cor de marca.
  const totalBoxHeight = 54
  const totalBoxY = y - totalBoxHeight
  page.drawRectangle({
    x: MARGIN,
    y: totalBoxY,
    width: CONTENT_WIDTH,
    height: totalBoxHeight,
    color: BRAND_END,
    opacity: 0.08,
    borderColor: BRAND_END,
    borderWidth: 1,
    borderOpacity: 0.5,
  })
  page.drawText(t.total, { x: MARGIN + 16, y: totalBoxY + totalBoxHeight - 22, size: 10, font: bold, color: MUTED })
  const totalSize = 20
  const totalWidth = bold.widthOfTextAtSize(amountLabel, totalSize)
  page.drawText(amountLabel, {
    x: MARGIN + CONTENT_WIDTH - 16 - totalWidth,
    y: totalBoxY + (totalBoxHeight - totalSize) / 2 + 2,
    size: totalSize,
    font: bold,
    color: DARK,
  })
  y = totalBoxY - 24

  // Rodapé de instruções de pagamento numa caixa visualmente separada.
  if (params.unit.billing_payment_instructions) {
    const bodyLines = params.unit.billing_payment_instructions
      .split(/\n+/)
      .flatMap((line) => wrapText(line, font, 9.5, CONTENT_WIDTH - 32))
    const lineHeight = 13
    const paddingTop = 16
    const headingHeight = 16
    const boxHeight = paddingTop + headingHeight + bodyLines.length * lineHeight + 8
    const boxY = y - boxHeight
    page.drawRectangle({ x: MARGIN, y: boxY, width: CONTENT_WIDTH, height: boxHeight, color: BOX_FILL, borderColor: LINE, borderWidth: 1 })
    let cy = boxY + boxHeight - paddingTop
    page.drawText(t.payment, { x: MARGIN + 16, y: cy, size: 10, font: bold, color: MUTED })
    cy -= headingHeight
    for (const line of bodyLines) {
      page.drawText(line, { x: MARGIN + 16, y: cy, size: 9.5, font, color: DARK })
      cy -= lineHeight
    }
  }

  const bytes = await doc.save()
  return Buffer.from(bytes)
}
