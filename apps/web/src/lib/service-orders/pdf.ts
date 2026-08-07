import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage } from 'pdf-lib'
import type { PortalServiceOrderPhoto } from '@/lib/portal-funcionario/data'

/**
 * Gerador de PDF da ordem de serviço preenchida (assinatura, fotos,
 * material, horas) — pedido do dono do produto: depois de assinada e
 * salva, tanto o técnico quanto o admin precisam conseguir baixar um
 * PDF com tudo que foi registrado. Mesmo padrão de
 * lib/invoices/pdf.ts (pdf-lib, sem browser headless), arquivo
 * independente por simplicidade (o conteúdo/layout não tem nada em
 * comum com fatura além da biblioteca).
 */

const PAGE_WIDTH = 612 // Letter (pt)
const PAGE_HEIGHT = 792
const MARGIN = 56
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2

const DARK = rgb(0.06, 0.09, 0.16)
const MUTED = rgb(0.4, 0.46, 0.55)
const LINE = rgb(0.85, 0.87, 0.9)

const BRAND_START = rgb(6 / 255, 182 / 255, 212 / 255) // #06b6d4
const BRAND_END = rgb(67 / 255, 97 / 255, 238 / 255) // #4361ee
const TOP_BAR_HEIGHT = 8

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pendente',
  completed: 'Finalizado',
  quote: 'Cotação',
}

/** Máximo de fotos embutidas por grupo (atendimento / nota fiscal) — protege contra ordens com centenas de fotos travando a função serverless. */
const MAX_EMBEDDED_PHOTOS_PER_GROUP = 30

const THUMB_SIZE = 110
const THUMB_GAP = 12
const THUMB_COLS = 4

function brandColorAt(t: number) {
  const lerp = (a: number, b: number) => a + (b - a) * t
  return rgb(lerp(BRAND_START.red, BRAND_END.red), lerp(BRAND_START.green, BRAND_END.green), lerp(BRAND_START.blue, BRAND_END.blue))
}

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

/** Best-effort: baixa e embute uma imagem (foto ou assinatura). Qualquer falha (rede, formato não suportado) só pula a imagem — nunca derruba a geração do resto do PDF. */
async function tryEmbedImageFromUrl(doc: PDFDocument, url: string): Promise<PDFImage | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const bytes = await res.arrayBuffer()
    const lower = url.toLowerCase().split('?')[0] ?? ''
    if (lower.endsWith('.png')) return await doc.embedPng(bytes)
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return await doc.embedJpg(bytes)
    // Sem extensão reconhecível (ex.: câmera do celular às vezes não manda uma) — tenta os dois formatos mais comuns.
    try {
      return await doc.embedPng(bytes)
    } catch {
      return await doc.embedJpg(bytes)
    }
  } catch {
    return null
  }
}

export async function generateServiceOrderPdf(params: {
  appointment: {
    service_order_number: string | null
    service_order_status: 'pending' | 'completed' | 'quote'
    service_order_summary_pt: string | null
    service_order_signed_by: string | null
    service_order_signed_at: string | null
    service_order_signature_url: string | null
    service_order_material_description: string | null
    service_order_material_value: number | null
    service_order_hours_needed: number | null
    service_order_part_purchase_link: string | null
    service_order_photos: PortalServiceOrderPhoto[]
    address: string | null
    starts_at: string
  }
  unitName: string
  customerName: string | null
}): Promise<Buffer> {
  const { appointment: a } = params

  const doc = await PDFDocument.create()
  let page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)

  function drawGradientBar(target: typeof page, barY: number) {
    const steps = 60
    const stepWidth = PAGE_WIDTH / steps
    for (let i = 0; i < steps; i++) {
      target.drawRectangle({ x: i * stepWidth, y: barY, width: stepWidth + 0.5, height: TOP_BAR_HEIGHT, color: brandColorAt(i / (steps - 1)) })
    }
  }

  function startPage(): number {
    drawGradientBar(page, PAGE_HEIGHT - TOP_BAR_HEIGHT)
    return PAGE_HEIGHT - TOP_BAR_HEIGHT - 40
  }

  function ensureSpace(needed: number, currentY: number): number {
    if (currentY - needed < MARGIN) {
      page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
      return startPage()
    }
    return currentY
  }

  let y = startPage()

  page.drawText('ORDEM DE SERVIÇO', { x: MARGIN, y, size: 20, font: bold, color: DARK })
  const statusLabel = STATUS_LABEL[a.service_order_status] ?? a.service_order_status
  const statusWidth = bold.widthOfTextAtSize(statusLabel, 10)
  page.drawText(statusLabel, { x: MARGIN + CONTENT_WIDTH - statusWidth, y: y + 4, size: 10, font: bold, color: DARK })
  y -= 22
  if (a.service_order_number) {
    page.drawText(`Nº ${a.service_order_number}`, { x: MARGIN, y, size: 12, font, color: MUTED })
    y -= 18
  }
  page.drawText(params.unitName, { x: MARGIN, y, size: 11, font: bold, color: DARK })
  y -= 16

  const dateLabel = new Date(a.starts_at).toLocaleDateString('pt-BR')
  const infoLines = [`Data do atendimento: ${dateLabel}`]
  if (params.customerName) infoLines.push(`Cliente: ${params.customerName}`)
  if (a.address) infoLines.push(`Endereço: ${a.address}`)
  for (const line of infoLines) {
    for (const wrapped of wrapText(line, font, 10.5, CONTENT_WIDTH)) {
      page.drawText(wrapped, { x: MARGIN, y, size: 10.5, font, color: DARK })
      y -= 15
    }
  }
  y -= 8
  page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + CONTENT_WIDTH, y }, thickness: 1, color: LINE })
  y -= 22

  if (a.service_order_summary_pt) {
    page.drawText('Resumo do trabalho', { x: MARGIN, y, size: 10, font: bold, color: MUTED })
    y -= 16
    for (const line of wrapText(a.service_order_summary_pt, font, 10.5, CONTENT_WIDTH)) {
      y = ensureSpace(15, y)
      page.drawText(line, { x: MARGIN, y, size: 10.5, font, color: DARK })
      y -= 15
    }
    y -= 10
  }

  if (a.service_order_hours_needed != null) {
    y = ensureSpace(18, y)
    page.drawText(`Horas necessárias: ${a.service_order_hours_needed}h`, { x: MARGIN, y, size: 10.5, font, color: DARK })
    y -= 20
  }

  if (a.service_order_material_description || a.service_order_material_value != null) {
    y = ensureSpace(18, y)
    page.drawText('Material necessário', { x: MARGIN, y, size: 10, font: bold, color: MUTED })
    y -= 15
    if (a.service_order_material_description) {
      for (const line of wrapText(a.service_order_material_description, font, 10.5, CONTENT_WIDTH)) {
        y = ensureSpace(15, y)
        page.drawText(line, { x: MARGIN, y, size: 10.5, font, color: DARK })
        y -= 15
      }
    }
    if (a.service_order_material_value != null) {
      y = ensureSpace(15, y)
      const amountLabel = a.service_order_material_value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
      page.drawText(`Valor estimado: ${amountLabel}`, { x: MARGIN, y, size: 10.5, font: bold, color: DARK })
      y -= 15
    }
    if (a.service_order_part_purchase_link) {
      y = ensureSpace(15, y)
      for (const line of wrapText(`Link de compra: ${a.service_order_part_purchase_link}`, font, 9.5, CONTENT_WIDTH)) {
        y = ensureSpace(14, y)
        page.drawText(line, { x: MARGIN, y, size: 9.5, font, color: MUTED })
        y -= 14
      }
    }
    y -= 8
  }

  if (a.service_order_signed_by) {
    y = ensureSpace(18, y)
    const signedLabel = a.service_order_signed_at
      ? `Assinado por ${a.service_order_signed_by} em ${new Date(a.service_order_signed_at).toLocaleDateString('pt-BR')}`
      : `Assinado por ${a.service_order_signed_by}`
    page.drawText(signedLabel, { x: MARGIN, y, size: 10.5, font: bold, color: DARK })
    y -= 18
  }

  if (a.service_order_signature_url) {
    const signatureImage = await tryEmbedImageFromUrl(doc, a.service_order_signature_url)
    if (signatureImage) {
      const maxW = 220
      const maxH = 90
      const scale = Math.min(maxW / signatureImage.width, maxH / signatureImage.height, 1)
      const w = signatureImage.width * scale
      const h = signatureImage.height * scale
      y = ensureSpace(h + 10, y)
      page.drawRectangle({ x: MARGIN, y: y - h, width: w, height: h, color: rgb(1, 1, 1) })
      page.drawImage(signatureImage, { x: MARGIN, y: y - h, width: w, height: h })
      y -= h + 20
    }
  }

  async function drawPhotoGrid(title: string, photos: PortalServiceOrderPhoto[]) {
    if (photos.length === 0) return
    y = ensureSpace(30, y)
    page.drawText(`${title} (${photos.length})`, { x: MARGIN, y, size: 10, font: bold, color: MUTED })
    y -= 16

    const shown = photos.slice(0, MAX_EMBEDDED_PHOTOS_PER_GROUP)
    let col = 0
    for (const photo of shown) {
      if (col === 0) {
        y = ensureSpace(THUMB_SIZE + THUMB_GAP, y)
      }
      const image = await tryEmbedImageFromUrl(doc, photo.url)
      const x = MARGIN + col * (THUMB_SIZE + THUMB_GAP)
      if (image) {
        const scale = Math.min(THUMB_SIZE / image.width, THUMB_SIZE / image.height)
        const w = image.width * scale
        const h = image.height * scale
        page.drawImage(image, { x: x + (THUMB_SIZE - w) / 2, y: y - THUMB_SIZE + (THUMB_SIZE - h) / 2, width: w, height: h })
      } else {
        page.drawRectangle({ x, y: y - THUMB_SIZE, width: THUMB_SIZE, height: THUMB_SIZE, borderColor: LINE, borderWidth: 1 })
        page.drawText('Indisponível', { x: x + 8, y: y - THUMB_SIZE / 2, size: 8, font, color: MUTED })
      }
      col = (col + 1) % THUMB_COLS
      if (col === 0) y -= THUMB_SIZE + THUMB_GAP
    }
    if (col !== 0) y -= THUMB_SIZE + THUMB_GAP
    if (photos.length > MAX_EMBEDDED_PHOTOS_PER_GROUP) {
      y = ensureSpace(14, y)
      page.drawText(`+ ${photos.length - MAX_EMBEDDED_PHOTOS_PER_GROUP} foto(s) adicionais disponíveis no painel.`, {
        x: MARGIN,
        y,
        size: 9,
        font,
        color: MUTED,
      })
      y -= 14
    }
    y -= 8
  }

  const servicePhotos = a.service_order_photos.filter((p) => p.kind !== 'material_invoice')
  const materialInvoicePhotos = a.service_order_photos.filter((p) => p.kind === 'material_invoice')
  await drawPhotoGrid('Fotos do atendimento', servicePhotos)
  await drawPhotoGrid('Notas fiscais de material', materialInvoicePhotos)

  const bytes = await doc.save()
  return Buffer.from(bytes)
}
