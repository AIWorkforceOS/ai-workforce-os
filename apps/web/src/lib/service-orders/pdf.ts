import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib'

/**
 * Gerador do PDF baixável da ordem de serviço — reproduz um MODELO
 * FIXO ÚNICO (o "Sign Off Sheet" real da 360 Service Provider), com
 * layout e marca fixos; só os dados da ordem mudam. Assinatura, nome
 * e data sempre vão pro bloco desenhado aqui (posição vertical
 * dinâmica, logo após o Scope Of Work — ver "BLOCO DE ASSINATURA"
 * abaixo), nunca dependendo de IA adivinhar onde ficam esses campos
 * num documento de terceiros — abordagens anteriores (carimbar em
 * cima do arquivo original da contratante, com ou sem detecção de
 * campo por IA) nunca acertavam a posição de forma confiável pra
 * qualquer ordem. Documento inteiro em INGLÊS e sem qualquer menção à
 * unidade Alizo (Mawi) — vai direto pro cliente (360) como se fosse
 * 100% emitido por ela. Ver migration 059/060 pros campos que
 * alimentam este template.
 */

const PAGE_WIDTH = 612 // Letter (pt)
const PAGE_HEIGHT = 792
const OUTER_MARGIN = 24
const MARGIN = 40
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2
const CONTENT_RIGHT = PAGE_WIDTH - MARGIN
const FOOTER_RESERVE = 46 // espaço reservado acima da borda inferior pro rodapé — nada de conteúdo entra aqui

const DARK = rgb(0.06, 0.09, 0.16)
const MUTED = rgb(0.42, 0.47, 0.55)
const LINE = rgb(0.78, 0.81, 0.85)
const BORDER = rgb(0.55, 0.58, 0.63)
const STAMP_GRAY = rgb(0.78, 0.8, 0.83)

/** Bloco fixo da contratante — sempre igual, não muda por ordem. */
const COMPANY_LINES = ['360 Service Provider', '11098 Biscayne Boulevard, Suite 305', 'Miami, FL 33161', 'Phone # 786-281-3413']

/**
 * Caminho fixo do asset de logo — ainda não enviado pelo dono do
 * produto. Assim que o PNG for colocado aqui, o PDF passa a usá-lo
 * automaticamente, sem mudança de código; até lá, cai pro placeholder
 * em texto (mesmo lugar/tamanho).
 */
const LOGO_PATH = join(process.cwd(), 'public', 'branding', '360-logo.png')

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

function drawRight(page: PDFPage, text: string, font: PDFFont, size: number, color: ReturnType<typeof rgb>, rightX: number, y: number) {
  const width = font.widthOfTextAtSize(text, size)
  page.drawText(text, { x: rightX - width, y, size, font, color })
}

function drawCenter(page: PDFPage, text: string, font: PDFFont, size: number, color: ReturnType<typeof rgb>, centerX: number, y: number) {
  const width = font.widthOfTextAtSize(text, size)
  page.drawText(text, { x: centerX - width / 2, y, size, font, color })
}

/** Formata como DD/MM/AAAA — pedido explícito pro campo "Date" do bloco de assinatura. */
function formatDateDmy(iso: string): string {
  const d = new Date(iso)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}/${d.getFullYear()}`
}

/** Formata como no documento de referência: "8/6/26 08:30 PM". */
function formatServiceDateUs(iso: string): string {
  const d = new Date(iso)
  const month = d.getMonth() + 1
  const day = d.getDate()
  const yy = String(d.getFullYear()).slice(-2)
  let hours = d.getHours()
  const minutes = String(d.getMinutes()).padStart(2, '0')
  const ampm = hours >= 12 ? 'PM' : 'AM'
  hours = hours % 12
  if (hours === 0) hours = 12
  return `${month}/${day}/${yy} ${String(hours).padStart(2, '0')}:${minutes} ${ampm}`
}

function formatPrintDate(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`
}

/** Best-effort: baixa e embute uma imagem (assinatura). Qualquer falha (rede, formato não suportado) só pula a imagem — nunca derruba a geração do resto do PDF. */
async function tryEmbedImageFromUrl(doc: PDFDocument, url: string): Promise<PDFImage | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const bytes = await res.arrayBuffer()
    const lower = url.toLowerCase().split('?')[0] ?? ''
    if (lower.endsWith('.png')) return await doc.embedPng(bytes)
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return await doc.embedJpg(bytes)
    try {
      return await doc.embedPng(bytes)
    } catch {
      return await doc.embedJpg(bytes)
    }
  } catch {
    return null
  }
}

/** Best-effort: lê o asset de logo local, se já tiver sido colocado no caminho fixo. Qualquer falha (arquivo ausente, formato inválido) cai pro placeholder em texto — nunca derruba a geração do PDF. */
async function tryEmbedLogo(doc: PDFDocument): Promise<PDFImage | null> {
  try {
    const bytes = readFileSync(LOGO_PATH)
    return await doc.embedPng(bytes)
  } catch {
    return null
  }
}

type ServiceOrderPdfAppointment = {
  service_order_number: string | null
  service_order_client_po: string | null
  service_order_priority: string | null
  service_order_order_type: string | null
  service_order_ivr_pin: string | null
  service_order_location_name: string | null
  service_order_location_phone: string | null
  service_order_issuer_name: string | null
  service_order_issuer_email: string | null
  /** Texto do Scope Of Work em INGLÊS (migration 060) — o único usado no PDF final, que vai pro cliente. service_order_summary_pt (português) é uso interno do técnico, nunca aparece aqui. */
  service_order_scope_en: string | null
  service_order_signed_by: string | null
  service_order_signed_at: string | null
  service_order_signature_url: string | null
  address: string | null
  starts_at: string
}

function addPage(doc: PDFDocument): { page: PDFPage; y: number } {
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
  page.drawRectangle({
    x: OUTER_MARGIN,
    y: OUTER_MARGIN,
    width: PAGE_WIDTH - OUTER_MARGIN * 2,
    height: PAGE_HEIGHT - OUTER_MARGIN * 2,
    borderColor: BORDER,
    borderWidth: 1,
  })
  return { page, y: PAGE_HEIGHT - MARGIN }
}

export async function generateServiceOrderPdf(params: { appointment: ServiceOrderPdfAppointment }): Promise<Buffer> {
  const { appointment: a } = params

  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const logo = await tryEmbedLogo(doc)
  const signatureImage = a.service_order_signature_url ? await tryEmbedImageFromUrl(doc, a.service_order_signature_url) : null

  const pages: PDFPage[] = []
  let current = addPage(doc)
  let page = current.page
  let y = current.y
  pages.push(page)

  function ensureSpace(needed: number) {
    if (y - needed < OUTER_MARGIN + FOOTER_RESERVE) {
      const next = addPage(doc)
      page = next.page
      y = next.y
      pages.push(page)
      page.drawText('Scope Of Work (cont.)', { x: MARGIN, y, size: 8.5, font: bold, color: MUTED })
      y -= 16
    }
  }

  // ---------------------------------------------------------------
  // CABEÇALHO
  // ---------------------------------------------------------------
  const headerTopY = y

  // Logo (canto superior esquerdo) — imagem real se já foi enviada, senão placeholder em texto no mesmo lugar.
  const logoCenterX = MARGIN + 18
  const logoCenterY = headerTopY - 18
  if (logo) {
    const logoSize = 36
    page.drawImage(logo, { x: logoCenterX - logoSize / 2, y: logoCenterY - logoSize / 2, width: logoSize, height: logoSize })
  } else {
    page.drawCircle({ x: logoCenterX, y: logoCenterY, size: 18, borderColor: BORDER, borderWidth: 1 })
    drawCenter(page, '360', bold, 11, DARK, logoCenterX, logoCenterY - 4)
  }

  // Bloco fixo da contratante, abaixo da logo.
  let leftY = headerTopY - 54
  COMPANY_LINES.forEach((line, i) => {
    const isFirst = i === 0
    page.drawText(line, { x: MARGIN, y: leftY, size: isFirst ? 9.5 : 8.3, font: isFirst ? bold : font, color: isFirst ? DARK : MUTED })
    leftY -= isFirst ? 12 : 10.5
  })

  // Centro: título + Vendor PO #.
  const centerX = PAGE_WIDTH / 2
  let centerY = headerTopY - 10
  drawCenter(page, 'SIGN OFF SHEET', bold, 21, DARK, centerX, centerY)
  centerY -= 26
  drawCenter(page, 'VENDOR PO #', bold, 7.5, MUTED, centerX, centerY)
  centerY -= 15
  drawCenter(page, a.service_order_number ?? '-', bold, 18, DARK, centerX, centerY)

  // Direita: 4 pares label/valor empilhados.
  let rightY = headerTopY - 3
  const pairs: [string, string][] = [
    ['Service Date', formatServiceDateUs(a.starts_at)],
    ['Client PO #', a.service_order_client_po ?? '-'],
    ['Priority', a.service_order_priority ?? '-'],
    ['Order Type', a.service_order_order_type ?? '-'],
  ]
  for (const [label, value] of pairs) {
    drawRight(page, label.toUpperCase(), bold, 6.8, MUTED, CONTENT_RIGHT, rightY)
    rightY -= 10
    drawRight(page, value, bold, 9.5, DARK, CONTENT_RIGHT, rightY)
    rightY -= 13
  }
  rightY -= 4
  if (a.service_order_issuer_name) {
    drawRight(page, a.service_order_issuer_name, bold, 9.5, DARK, CONTENT_RIGHT, rightY)
    rightY -= 12
  }
  if (a.service_order_issuer_email) {
    drawRight(page, a.service_order_issuer_email, font, 8, MUTED, CONTENT_RIGHT, rightY)
    rightY -= 12
  }

  y = Math.min(leftY, rightY) - 14
  page.drawLine({ start: { x: MARGIN, y }, end: { x: CONTENT_RIGHT, y }, thickness: 1, color: LINE })
  y -= 20

  // ---------------------------------------------------------------
  // SERVICE LOCATION + IVR PIN #
  // ---------------------------------------------------------------
  const sectionTopY = y
  const locColWidth = 320
  const ivrColX = MARGIN + locColWidth + 20

  let locY = sectionTopY
  page.drawText('SERVICE LOCATION', { x: MARGIN, y: locY, size: 9, font: bold, color: MUTED })
  locY -= 14
  if (a.service_order_location_name) {
    page.drawText(a.service_order_location_name, { x: MARGIN, y: locY, size: 10, font: bold, color: DARK })
    locY -= 13
  }
  if (a.address) {
    for (const line of wrapText(a.address, font, 9.5, locColWidth)) {
      page.drawText(line, { x: MARGIN, y: locY, size: 9.5, font, color: DARK })
      locY -= 12.5
    }
  }
  page.drawText('Phone #', { x: MARGIN, y: locY, size: 8.5, font: bold, color: MUTED })
  if (a.service_order_location_phone) {
    page.drawText(a.service_order_location_phone, { x: MARGIN + 44, y: locY, size: 8.5, font, color: DARK })
  }
  locY -= 14

  let ivrY = sectionTopY
  page.drawText('IVR Pin #', { x: ivrColX, y: ivrY, size: 9, font: bold, color: MUTED })
  ivrY -= 18
  page.drawText(a.service_order_ivr_pin ?? '-', { x: ivrColX, y: ivrY, size: 14, font: bold, color: DARK })
  ivrY -= 14

  y = Math.min(locY, ivrY) - 12
  page.drawLine({ start: { x: MARGIN, y }, end: { x: CONTENT_RIGHT, y }, thickness: 1, color: LINE })
  y -= 22

  // ---------------------------------------------------------------
  // SERVICE DESCRIPTION (paginável)
  // ---------------------------------------------------------------
  page.drawText('SERVICE DESCRIPTION', { x: MARGIN, y, size: 9.5, font: bold, color: MUTED })
  y -= 16

  const scopeLabel = 'Scope Of Work: '
  const scopeText = a.service_order_scope_en ?? ''
  if (scopeText) {
    const labelWidth = bold.widthOfTextAtSize(scopeLabel, 10)
    const words = scopeText.split(/\s+/).filter(Boolean)
    const firstLineWords: string[] = []
    let idx = 0
    while (idx < words.length) {
      const word = words[idx]
      if (word === undefined) break
      const attempt = firstLineWords.length ? `${firstLineWords.join(' ')} ${word}` : word
      if (firstLineWords.length > 0 && font.widthOfTextAtSize(attempt, 10) > CONTENT_WIDTH - labelWidth) break
      firstLineWords.push(word)
      idx++
    }
    ensureSpace(15)
    page.drawText(scopeLabel, { x: MARGIN, y, size: 10, font: bold, color: DARK })
    page.drawText(firstLineWords.join(' '), { x: MARGIN + labelWidth, y, size: 10, font, color: DARK })
    y -= 15
    const remaining = words.slice(idx).join(' ')
    if (remaining) {
      for (const line of wrapText(remaining, font, 10, CONTENT_WIDTH)) {
        ensureSpace(15)
        page.drawText(line, { x: MARGIN, y, size: 10, font, color: DARK })
        y -= 15
      }
    }
  } else {
    ensureSpace(15)
    page.drawText('Scope Of Work: -', { x: MARGIN, y, size: 10, font, color: MUTED })
    y -= 15
  }

  // ---------------------------------------------------------------
  // BLOCO DE ASSINATURA — posição DINÂMICA: logo abaixo do fim do
  // texto do Scope Of Work (com um respiro fixo), não mais uma
  // coordenada baixa e fixa na página; só pula pra nova página se
  // realmente não couber (ensureSpace).
  // ---------------------------------------------------------------
  const sigLineWidth = 270
  const SIGNATURE_IMAGE_MAX_H = 140
  const STAMP_TOP_GAP = 30
  const STAMP_HEIGHT = 78
  const STAMP_LABEL_RESERVE = 15 // espaço acima da caixa pro rótulo "STORE STAMP"
  const BELOW_LINE_RESERVE = 55 // linha + "Print Name"/"Date" + rótulos, com folga
  const GAP_AFTER_SCOPE = 34

  let sigImageW = 0
  let sigImageH = 0
  if (signatureImage) {
    const maxW = sigLineWidth - 10
    const scale = Math.min(maxW / signatureImage.width, SIGNATURE_IMAGE_MAX_H / signatureImage.height, 1)
    sigImageW = signatureImage.width * scale
    sigImageH = signatureImage.height * scale
  }

  // Extensão acima da linha de assinatura: a maior entre o espaço pra
  // caixa "STORE STAMP" (sempre desenhada) e a altura da imagem da
  // assinatura (quando existe, agora bem maior que antes).
  const aboveLineReserve = Math.max(STAMP_TOP_GAP + STAMP_LABEL_RESERVE, signatureImage ? sigImageH + 4 : 0)
  const signatureBlockHeight = aboveLineReserve + BELOW_LINE_RESERVE

  ensureSpace(GAP_AFTER_SCOPE + signatureBlockHeight)
  const topOfSignatureBlock = y - GAP_AFTER_SCOPE
  const sigLineY = topOfSignatureBlock - aboveLineReserve

  if (signatureImage) {
    const sigImageX = MARGIN + (sigLineWidth - sigImageW) / 2
    page.drawImage(signatureImage, { x: sigImageX, y: sigLineY, width: sigImageW, height: sigImageH })
  }
  page.drawLine({ start: { x: MARGIN, y: sigLineY }, end: { x: MARGIN + sigLineWidth, y: sigLineY }, thickness: 1, color: DARK })
  page.drawText("Store Manager's Signature", { x: MARGIN, y: sigLineY - 11, size: 8, font, color: MUTED })

  const subFieldsY = sigLineY - 36
  const nameLineWidth = 150
  const dateLineX = MARGIN + nameLineWidth + 20
  const dateLineWidth = 90
  if (a.service_order_signed_by) {
    page.drawText(a.service_order_signed_by, { x: MARGIN, y: subFieldsY + 4, size: 10, font: bold, color: DARK })
  }
  page.drawLine({ start: { x: MARGIN, y: subFieldsY }, end: { x: MARGIN + nameLineWidth, y: subFieldsY }, thickness: 1, color: DARK })
  page.drawText('Print Name', { x: MARGIN, y: subFieldsY - 11, size: 8, font, color: MUTED })

  if (a.service_order_signed_at) {
    page.drawText(formatDateDmy(a.service_order_signed_at), { x: dateLineX, y: subFieldsY + 4, size: 10, font: bold, color: DARK })
  }
  page.drawLine({ start: { x: dateLineX, y: subFieldsY }, end: { x: dateLineX + dateLineWidth, y: subFieldsY }, thickness: 1, color: DARK })
  page.drawText('Date', { x: dateLineX, y: subFieldsY - 11, size: 8, font, color: MUTED })

  // STORE STAMP — só visual/fixo, caixa tracejada com "Mandatory" em cinza claro.
  const stampX = MARGIN + sigLineWidth + 40
  const stampWidth = CONTENT_RIGHT - stampX
  const stampTop = sigLineY + STAMP_TOP_GAP
  page.drawText('STORE STAMP', { x: stampX, y: stampTop + 6, size: 9, font: bold, color: MUTED })
  page.drawRectangle({
    x: stampX,
    y: stampTop - STAMP_HEIGHT,
    width: stampWidth,
    height: STAMP_HEIGHT,
    borderColor: LINE,
    borderWidth: 1,
    borderDashArray: [4, 3],
  })
  drawCenter(page, 'Mandatory', bold, 16, STAMP_GRAY, stampX + stampWidth / 2, stampTop - STAMP_HEIGHT / 2 - 6)

  // ---------------------------------------------------------------
  // RODAPÉ — em todas as páginas geradas. Sem menção à unidade
  // (Mawi): o documento inteiro é emitido como se fosse 100% da 360.
  // ---------------------------------------------------------------
  const printDateLabel = `Print Date: ${formatPrintDate(new Date())}`
  pages.forEach((p, i) => {
    p.drawText(printDateLabel, { x: MARGIN, y: OUTER_MARGIN + 14, size: 7.5, font, color: MUTED })
    drawRight(p, `Page ${i + 1} of ${pages.length}`, font, 7.5, MUTED, CONTENT_RIGHT, OUTER_MARGIN + 14)
  })

  const bytes = await doc.save()
  return Buffer.from(bytes)
}
