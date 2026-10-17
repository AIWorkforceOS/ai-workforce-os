import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib'
import { addLinkAnnotation } from './pdf-link'

/**
 * Relatório fotográfico da ordem — páginas extras do Sign Off (e também PDF
 * à parte). Inglês, sem menção à Alizo/Mawi (vai pro cliente 360). Cada foto
 * é clicável (abre a imagem original em tamanho cheio) e cada vídeo é um
 * bloco clicável que abre o arquivo no navegador — PDF não toca vídeo, então
 * o link é o caminho confiável em qualquer leitor.
 *
 * Tamanho: a resposta de uma função da Vercel é limitada a ~4,5MB, então
 * as fotos são redimensionadas (e giradas pelo EXIF) antes de entrar no PDF,
 * com qualidade menor quando há muitas.
 */

export type ReportMedia = { url: string; kind: 'before' | 'after' | 'service' | 'material_invoice' | 'video' | undefined; uploaded_at?: string }

export type ReportSection = { title: string; note?: string; items: ReportMedia[]; isVideo: boolean }

const PAGE_WIDTH = 612
const PAGE_HEIGHT = 792
const MARGIN = 40
const GAP = 14
const COLS = 2
const CELL_W = (PAGE_WIDTH - MARGIN * 2 - GAP * (COLS - 1)) / COLS
const IMG_H = 170
const CAPTION_H = 16
const CELL_H = IMG_H + CAPTION_H + GAP
const HEADER_H = 78
const FOOTER_RESERVE = 46

const DARK = rgb(0.06, 0.09, 0.16)
const MUTED = rgb(0.42, 0.47, 0.55)
const LINE = rgb(0.78, 0.81, 0.85)
const LINK = rgb(0.09, 0.45, 0.82)

/** Agrupa a mídia da ordem nas seções do relatório, na ordem em que o cliente quer ler. */
export function groupReportSections(media: ReportMedia[]): ReportSection[] {
  const pick = (fn: (m: ReportMedia) => boolean) => media.filter(fn)
  const sections: ReportSection[] = [
    { title: 'BEFORE', items: pick((m) => m.kind === 'before'), isVideo: false },
    { title: 'AFTER', items: pick((m) => m.kind === 'after'), isVideo: false },
    { title: 'OTHER PHOTOS', items: pick((m) => !m.kind || m.kind === 'service'), isVideo: false },
    { title: 'MATERIAL RECEIPTS', items: pick((m) => m.kind === 'material_invoice'), isVideo: false },
    { title: 'VIDEOS', note: 'Click a video to open and play it in your browser.', items: pick((m) => m.kind === 'video'), isVideo: true },
  ]
  return sections.filter((s) => s.items.length > 0)
}

/** Qualidade/tamanho das fotos conforme a quantidade, pra o PDF final caber no limite de resposta da Vercel. */
export function imageBudget(photoCount: number): { maxSide: number; quality: number } {
  if (photoCount <= 12) return { maxSide: 1280, quality: 78 }
  if (photoCount <= 24) return { maxSide: 1000, quality: 70 }
  return { maxSide: 800, quality: 62 }
}

export function formatReportTimestamp(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('en-US', { timeZone: 'America/New_York', month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

type PreparedBytes = { bytes: Uint8Array; format: 'jpg' | 'png' }

/** Baixa, gira pelo EXIF e reduz. Qualquer falha devolve null (a célula vira "image unavailable", o link continua valendo). */
export async function defaultPrepareImage(url: string, budget: { maxSide: number; quality: number }): Promise<PreparedBytes | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) })
    if (!res.ok) return null
    const input = Buffer.from(await res.arrayBuffer())
    try {
      const sharp = (await import('sharp')).default
      const out = await sharp(input).rotate().resize({ width: budget.maxSide, height: budget.maxSide, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: budget.quality, mozjpeg: true }).toBuffer()
      return { bytes: out, format: 'jpg' }
    } catch {
      // sem sharp ou formato estranho: usa o original se for jpg/png
      const lower = url.toLowerCase().split('?')[0] ?? ''
      if (lower.endsWith('.png')) return { bytes: input, format: 'png' }
      if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return { bytes: input, format: 'jpg' }
      return null
    }
  } catch {
    return null
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i]!)
    }
  })
  await Promise.all(workers)
  return results
}

export type PhotoReportHeader = {
  orderNumber: string | null
  clientPo: string | null
  locationName: string | null
  serviceDate: string | null
  /** Página pública (sem login) onde o cliente baixa tudo — vira o botão "Download all" em cada página do relatório. */
  downloadUrl?: string | null
}

export type ReportDeps = { prepareImage?: typeof defaultPrepareImage }

/**
 * Desenha as páginas do relatório no documento recebido (`font`/`bold` já
 * embutidos pelo chamador). Devolve quantas páginas foram adicionadas.
 */
export async function drawPhotoReportPages(
  doc: PDFDocument,
  media: ReportMedia[],
  header: PhotoReportHeader,
  font: PDFFont,
  bold: PDFFont,
  deps: ReportDeps = {},
): Promise<number> {
  const sections = groupReportSections(media)
  if (sections.length === 0) return 0
  const prepare = deps.prepareImage ?? defaultPrepareImage
  const photoCount = sections.filter((s) => !s.isVideo).reduce((n, s) => n + s.items.length, 0)
  const budget = imageBudget(photoCount)

  // Baixa/otimiza tudo antes (4 por vez) e embute em ordem.
  const photos = sections.filter((s) => !s.isVideo).flatMap((s) => s.items)
  const prepared = await mapLimit(photos, 4, (m) => prepare(m.url, budget))
  const embedded = new Map<string, PDFImage | null>()
  for (const [i, m] of photos.entries()) {
    const p = prepared[i]
    let image: PDFImage | null = null
    if (p) {
      try {
        image = p.format === 'png' ? await doc.embedPng(p.bytes) : await doc.embedJpg(p.bytes)
      } catch {
        image = null
      }
    }
    embedded.set(m.url, image)
  }

  const pagesBefore = doc.getPageCount()
  const startedPages: PDFPage[] = []
  let page!: PDFPage
  let y = 0

  function newPage() {
    page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
    startedPages.push(page)
    page.drawText('PHOTOGRAPHIC REPORT', { x: MARGIN, y: PAGE_HEIGHT - MARGIN - 8, size: 16, font: bold, color: DARK })
    const line1 = [header.orderNumber ? `Work Order # ${header.orderNumber}` : null, header.clientPo ? `PO # ${header.clientPo}` : null].filter(Boolean).join('   ·   ')
    const line2 = [header.locationName, header.serviceDate].filter(Boolean).join('   ·   ')
    if (line1) page.drawText(line1, { x: MARGIN, y: PAGE_HEIGHT - MARGIN - 28, size: 9, font, color: MUTED })
    if (line2) page.drawText(line2, { x: MARGIN, y: PAGE_HEIGHT - MARGIN - 41, size: 9, font, color: MUTED })
    if (header.downloadUrl) {
      const label = 'DOWNLOAD ALL PHOTOS & VIDEOS'
      const w = bold.widthOfTextAtSize(label, 8.5) + 24
      const x = PAGE_WIDTH - MARGIN - w
      const by = PAGE_HEIGHT - MARGIN - 20
      page.drawRectangle({ x, y: by, width: w, height: 24, color: LINK })
      page.drawText(label, { x: x + 12, y: by + 8, size: 8.5, font: bold, color: rgb(1, 1, 1) })
      addLinkAnnotation(page, header.downloadUrl, { x, y: by, width: w, height: 24 })
    }
    page.drawLine({ start: { x: MARGIN, y: PAGE_HEIGHT - MARGIN - 52 }, end: { x: PAGE_WIDTH - MARGIN, y: PAGE_HEIGHT - MARGIN - 52 }, thickness: 1, color: LINE })
    y = PAGE_HEIGHT - MARGIN - HEADER_H + 10
  }

  newPage()
  for (const section of sections) {
    // título da seção (+ ao menos uma linha de células junto)
    if (y - 24 - CELL_H < FOOTER_RESERVE) newPage()
    page.drawText(`${section.title} (${section.items.length})`, { x: MARGIN, y: y - 12, size: 11, font: bold, color: DARK })
    y -= 22
    if (section.note) {
      page.drawText(section.note, { x: MARGIN, y: y - 8, size: 8.5, font, color: MUTED })
      y -= 16
    }
    for (const [i, item] of section.items.entries()) {
      const col = i % COLS
      if (col === 0 && i > 0) y -= CELL_H
      if (y - CELL_H < FOOTER_RESERVE) {
        newPage()
        page.drawText(`${section.title} (cont.)`, { x: MARGIN, y: y - 12, size: 11, font: bold, color: DARK })
        y -= 22
      }
      const x = MARGIN + col * (CELL_W + GAP)
      const top = y
      const imgBottom = top - IMG_H
      const label = `${section.isVideo ? 'Video' : 'Photo'} ${i + 1}${item.uploaded_at ? ` · ${formatReportTimestamp(item.uploaded_at)}` : ''}`

      if (section.isVideo) {
        page.drawRectangle({ x, y: imgBottom, width: CELL_W, height: IMG_H, color: rgb(0.1, 0.13, 0.2), borderColor: LINE, borderWidth: 1 })
        const cx = x + CELL_W / 2
        const cy = imgBottom + IMG_H / 2 + 8
        page.drawCircle({ x: cx, y: cy, size: 26, color: rgb(1, 1, 1), opacity: 0.9 })
        page.drawSvgPath('M -8 -13 L 14 0 L -8 13 Z', { x: cx, y: cy, color: rgb(0.1, 0.13, 0.2), scale: 1 })
        const t = 'Click to play video'
        page.drawText(t, { x: cx - bold.widthOfTextAtSize(t, 10) / 2, y: imgBottom + 26, size: 10, font: bold, color: rgb(1, 1, 1) })
      } else {
        const image = embedded.get(item.url) ?? null
        if (image) {
          const scale = Math.min(CELL_W / image.width, IMG_H / image.height)
          const w = image.width * scale
          const h = image.height * scale
          page.drawRectangle({ x, y: imgBottom, width: CELL_W, height: IMG_H, color: rgb(0.96, 0.97, 0.98), borderColor: LINE, borderWidth: 0.5 })
          page.drawImage(image, { x: x + (CELL_W - w) / 2, y: imgBottom + (IMG_H - h) / 2, width: w, height: h })
        } else {
          page.drawRectangle({ x, y: imgBottom, width: CELL_W, height: IMG_H, color: rgb(0.96, 0.97, 0.98), borderColor: LINE, borderWidth: 1 })
          const t = 'Image preview unavailable — click to open'
          page.drawText(t, { x: x + CELL_W / 2 - font.widthOfTextAtSize(t, 9) / 2, y: imgBottom + IMG_H / 2, size: 9, font, color: MUTED })
        }
      }
      // a célula inteira é clicável
      addLinkAnnotation(page, item.url, { x, y: imgBottom, width: CELL_W, height: IMG_H })
      page.drawText(label, { x, y: imgBottom - 12, size: 8.5, font, color: LINK })
    }
    y -= CELL_H
  }

  // rodapé do relatório (numeração própria)
  const total = startedPages.length
  startedPages.forEach((p, i) => {
    const text = `Photographic report — page ${i + 1} of ${total}`
    p.drawText(text, { x: PAGE_WIDTH - MARGIN - font.widthOfTextAtSize(text, 7.5), y: 38, size: 7.5, font, color: MUTED })
    if (header.downloadUrl) {
      const note = 'Download all photos & videos (ZIP or save to phone):'
      p.drawText(note, { x: MARGIN, y: 38, size: 7.5, font, color: MUTED })
      const urlText = header.downloadUrl
      p.drawText(urlText, { x: MARGIN, y: 28, size: 7, font, color: LINK })
      addLinkAnnotation(p, header.downloadUrl, { x: MARGIN, y: 25, width: font.widthOfTextAtSize(urlText, 7), height: 12 })
    }
  })
  return doc.getPageCount() - pagesBefore
}

/** PDF só com o relatório fotográfico. Devolve null quando a ordem não tem nenhuma mídia. */
export async function generatePhotoReportPdf(
  media: ReportMedia[],
  header: PhotoReportHeader,
  deps: ReportDeps = {},
): Promise<Buffer | null> {
  if (groupReportSections(media).length === 0) return null
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  await drawPhotoReportPages(doc, media, header, font, bold, deps)
  return Buffer.from(await doc.save())
}
