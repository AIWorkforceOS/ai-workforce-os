import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib'
import type { PortalServiceOrderPhoto } from '@/lib/portal-funcionario/data'
import { isExtractableImageFile, isExtractablePdfFile } from '@/lib/service-orders/extraction'
import { detectSignatureFieldsFromImage, detectSignatureFieldsFromPdf, type SignatureFieldLocations } from '@/lib/service-orders/signature-fields'

/**
 * Gerador do PDF baixável da ordem de serviço — pedido do dono do
 * produto: o documento final precisa ser a ORDEM ORIGINAL (o arquivo
 * que a contratante, ex. Mawi/360, mandou e o admin anexou —
 * service_order_file_url/service_order_file_name, migration 056) com a
 * assinatura, nome e data CARIMBADOS nela, não um resumo à parte. Se o
 * original for PDF, carimba a última página dele. Se for imagem,
 * embute a imagem como fundo de uma página nova e carimba por cima.
 *
 * A posição do carimbo tenta seguir os campos reais "Signature" /
 * "Print Name" / "Date" impressos no formulário original (localizados
 * por IA multimodal — ver lib/service-orders/signature-fields.ts),
 * já que cada contratante usa um layout diferente. Se a IA não achar
 * um campo específico (ou falhar por completo — sem API key, erro de
 * rede, resposta inválida), cai pro box fixo no canto inferior direito
 * de antes (stampSignatureBlock) — nunca trava a geração do PDF por
 * causa disso.
 *
 * Fallback (sem arquivo original anexado, ou falha ao baixar/embutir
 * — ex. formato de imagem sem suporte no pdf-lib como gif/webp): gera
 * o resumo textual de antes, pra sempre devolver algum PDF.
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

type ServiceOrderPdfAppointment = {
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
  service_order_file_url: string | null
  service_order_file_name: string | null
  address: string | null
  starts_at: string
}

/** Desenha a assinatura + nome + data num box no canto inferior direito da página — funciona tanto sobre o PDF/imagem original quanto no resumo de fallback. Não desenha nada se não houver assinatura nem nome (ordem ainda não assinada). */
function stampSignatureBlock(
  page: PDFPage,
  opts: { signatureImage: PDFImage | null; signedBy: string | null; signedAt: string | null; font: PDFFont; bold: PDFFont },
) {
  const { signatureImage, signedBy, signedAt, font, bold } = opts
  if (!signatureImage && !signedBy) return

  const { width } = page.getSize()
  const margin = 24
  const padding = 12
  const boxWidth = Math.min(230, Math.max(120, width - margin * 2))

  let sigW = 0
  let sigH = 0
  if (signatureImage) {
    const maxW = boxWidth - padding * 2
    const maxH = 46
    const scale = Math.min(maxW / signatureImage.width, maxH / signatureImage.height, 1)
    sigW = signatureImage.width * scale
    sigH = signatureImage.height * scale
  }

  let contentHeight = 12 // rótulo
  if (signatureImage) contentHeight += sigH + 6
  if (signedBy) contentHeight += 14
  if (signedAt) contentHeight += 12
  const boxHeight = contentHeight + padding * 2

  const boxX = width - boxWidth - margin
  const boxY = margin

  page.drawRectangle({ x: boxX, y: boxY, width: boxWidth, height: boxHeight, color: rgb(1, 1, 1), opacity: 0.94, borderColor: LINE, borderWidth: 1 })

  let cursorY = boxY + boxHeight - padding - 8
  page.drawText('Assinatura do responsável', { x: boxX + padding, y: cursorY, size: 8, font: bold, color: MUTED })
  cursorY -= 12

  if (signatureImage) {
    page.drawImage(signatureImage, { x: boxX + padding, y: cursorY - sigH, width: sigW, height: sigH })
    cursorY -= sigH + 6
  }
  if (signedBy) {
    page.drawText(signedBy, { x: boxX + padding, y: cursorY, size: 10, font: bold, color: DARK })
    cursorY -= 14
  }
  if (signedAt) {
    const dateLabel = new Date(signedAt).toLocaleString('pt-BR')
    page.drawText(`Assinado em ${dateLabel}`, { x: boxX + padding, y: cursorY, size: 8.5, font, color: MUTED })
  }
}

/**
 * Desenha assinatura/nome/data em cima dos campos reais do formulário,
 * já localizados pela IA (frações 0.0–1.0, origem no canto superior
 * esquerdo — ver signature-fields.ts). Cada campo é independente: se a
 * IA não localizou um deles (ou não temos o dado, ex. sem assinatura
 * ainda), simplesmente pula esse campo em vez de travar ou desenhar
 * algo errado. Devolve true se carimbou pelo menos um campo.
 */
function stampSignatureAtFields(page: PDFPage, locations: SignatureFieldLocations, opts: { signatureImage: PDFImage | null; signedBy: string | null; signedAt: string | null; font: PDFFont; bold: PDFFont }): boolean {
  const { signatureImage, signedBy, signedAt, font, bold } = opts
  const { width, height } = page.getSize()
  let stampedAny = false

  function toPdfPoint(frac: { xFrac: number; yFrac: number }) {
    return { x: frac.xFrac * width, y: height - frac.yFrac * height }
  }

  if (locations.signature && signatureImage) {
    const { x, y } = toPdfPoint(locations.signature)
    const maxW = 170
    const maxH = 42
    const scale = Math.min(maxW / signatureImage.width, maxH / signatureImage.height, 1)
    const w = signatureImage.width * scale
    const h = signatureImage.height * scale
    page.drawImage(signatureImage, { x: x - w / 2, y: y - h / 2, width: w, height: h })
    stampedAny = true
  }

  if (locations.printName && signedBy) {
    const { x, y } = toPdfPoint(locations.printName)
    const size = 10
    page.drawText(signedBy, { x, y: y - size / 2, size, font: bold, color: DARK })
    stampedAny = true
  }

  if (locations.date && signedAt) {
    const { x, y } = toPdfPoint(locations.date)
    const size = 9
    const dateLabel = new Date(signedAt).toLocaleDateString('pt-BR')
    page.drawText(dateLabel, { x, y: y - size / 2, size, font, color: DARK })
    stampedAny = true
  }

  return stampedAny
}

/**
 * Tenta localizar os campos reais do formulário via IA e carimbar em
 * cima deles. Best-effort isolado: qualquer falha (IA indisponível,
 * campo não encontrado, erro inesperado) devolve false e quem chama
 * cai pro box fixo — nunca derruba a geração do documento original.
 */
async function tryStampAtDetectedFields(params: {
  pages: PDFPage[]
  lastPage: PDFPage
  fileName: string
  bytes: ArrayBuffer
  fileUrl: string
  stampOpts: { signatureImage: PDFImage | null; signedBy: string | null; signedAt: string | null; font: PDFFont; bold: PDFFont }
}): Promise<boolean> {
  try {
    const locations = isExtractablePdfFile(params.fileName)
      ? await detectSignatureFieldsFromPdf({
          fileName: params.fileName,
          base64Pdf: Buffer.from(params.bytes).toString('base64'),
          pageCount: params.pages.length,
        })
      : await detectSignatureFieldsFromImage({ imageUrl: params.fileUrl })

    if (!locations) return false

    const targetPage = params.pages[locations.pageNumber - 1] ?? params.lastPage
    return stampSignatureAtFields(targetPage, locations, params.stampOpts)
  } catch (error) {
    console.error(
      `[service_order_pdf] falha ao carimbar nos campos detectados, caindo pro box fixo: ${error instanceof Error ? error.message : String(error)}`,
    )
    return false
  }
}

/** Embute os bytes de uma imagem original (jpg/png) conforme a extensão do nome do arquivo — gif/webp não têm suporte de embed no pdf-lib e derrubam pra exceção (capturada por quem chama). */
async function embedImageByFileName(doc: PDFDocument, bytes: ArrayBuffer, fileName: string): Promise<PDFImage> {
  const lower = fileName.toLowerCase()
  if (lower.endsWith('.png')) return doc.embedPng(bytes)
  return doc.embedJpg(bytes)
}

/**
 * Baixa a ordem original anexada e carimba assinatura/nome/data nela.
 * Best-effort: qualquer falha (download, formato não suportado, PDF
 * corrompido) devolve null e quem chama cai pro resumo gerado.
 */
async function tryStampOriginalDocument(a: ServiceOrderPdfAppointment): Promise<Buffer | null> {
  if (!a.service_order_file_url) return null
  const fileName = a.service_order_file_name ?? ''

  try {
    const res = await fetch(a.service_order_file_url)
    if (!res.ok) return null
    const bytes = await res.arrayBuffer()

    let doc: PDFDocument
    if (isExtractablePdfFile(fileName)) {
      doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
    } else if (isExtractableImageFile(fileName)) {
      doc = await PDFDocument.create()
      const image = await embedImageByFileName(doc, bytes, fileName)
      const page = doc.addPage([image.width, image.height])
      page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height })
    } else {
      return null
    }

    const pages = doc.getPages()
    const lastPage = pages[pages.length - 1]
    if (!lastPage) return null

    const font = await doc.embedFont(StandardFonts.Helvetica)
    const bold = await doc.embedFont(StandardFonts.HelveticaBold)
    const signatureImage = a.service_order_signature_url ? await tryEmbedImageFromUrl(doc, a.service_order_signature_url) : null
    const stampOpts = { signatureImage, signedBy: a.service_order_signed_by, signedAt: a.service_order_signed_at, font, bold }

    const stampedAtFields = await tryStampAtDetectedFields({ pages, lastPage, fileName, bytes, fileUrl: a.service_order_file_url, stampOpts })
    if (!stampedAtFields) {
      stampSignatureBlock(lastPage, stampOpts)
    }

    const savedBytes = await doc.save()
    return Buffer.from(savedBytes)
  } catch (error) {
    console.error(
      `[service_order_pdf] falha ao carimbar a ordem original, caindo pro resumo gerado: ${error instanceof Error ? error.message : String(error)}`,
    )
    return null
  }
}

export async function generateServiceOrderPdf(params: {
  appointment: ServiceOrderPdfAppointment
  unitName: string
  customerName: string | null
}): Promise<Buffer> {
  const stamped = await tryStampOriginalDocument(params.appointment)
  if (stamped) return stamped
  return generateSummaryServiceOrderPdf(params)
}

/** Fallback: resumo gerado do zero (número, endereço, resumo do trabalho, material, fotos, assinatura) — usado quando não há ordem original anexada ou não foi possível carimbá-la. */
async function generateSummaryServiceOrderPdf(params: {
  appointment: ServiceOrderPdfAppointment
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
