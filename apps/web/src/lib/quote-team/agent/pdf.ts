import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import type { Diagnosis } from '../contracts'
import { defaultPrepareImage, imageBudget } from '@/lib/service-orders/photo-report'
import { addLinkAnnotation } from '@/lib/service-orders/pdf-link'
import type { TechnicianDraftView } from '../visibility'

/**
 * PDF da COTAÇÃO TÉCNICA (distinto do Sign Off de serviço executado). Só dados técnicos: o PDF NUNCA traz tarifa comercial, custo interno,
 * margem, lucro ou preço faturado. Preços de COMPRA dos materiais ficam FORA por padrão (documento para o cliente); só entram quando o
 * administrador autoriza (includeMaterialPrices) para um destinatário/tipo de documento específico.
 */
export type TechnicalQuotePdfInput = {
  appointment: { service_order_number: string | null; client_po: string | null; location_name: string | null; address: string | null; starts_at: string }
  view: TechnicianDraftView
  approved: boolean
  approvedAt: string | null
  version: number
  includeMaterialPrices?: boolean
  photoUrls?: string[]
  prepareImage?: typeof defaultPrepareImage
}

const W = 612
const H = 792
const M = 40
const CW = W - M * 2
const FOOT = 46
const DARK = rgb(0.06, 0.09, 0.16)
const MUTED = rgb(0.42, 0.47, 0.55)
const LINE = rgb(0.78, 0.81, 0.85)
const ACCENT = rgb(0.09, 0.45, 0.82)
const WARN = rgb(0.72, 0.38, 0.04)
const OK = rgb(0.09, 0.5, 0.25)

/** Helvetica (WinAnsi) não codifica tudo: troca o que não cabe por equivalentes simples (nunca derruba o PDF). */
export function pdfSafe(text: unknown): string {
  return String(text ?? '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/[•●]/g, '-')
    .replace(/\r/g, '')
    .replace(/[^\n -~ -ÿ]/g, '?')
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const out: string[] = []
  for (const paragraph of pdfSafe(text).split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean)
    if (words.length === 0) {
      out.push('')
      continue
    }
    let current = ''
    for (const word of words) {
      const attempt = current ? `${current} ${word}` : word
      if (current && font.widthOfTextAtSize(attempt, size) > maxWidth) {
        out.push(current)
        current = word
      } else current = attempt
    }
    if (current) out.push(current)
  }
  return out
}

class Writer {
  page!: PDFPage
  y = 0
  constructor(private doc: PDFDocument, readonly font: PDFFont, readonly bold: PDFFont, private footerNote: string) {
    this.newPage()
  }
  newPage() {
    this.page = this.doc.addPage([W, H])
    this.y = H - M
    this.page.drawText(pdfSafe(this.footerNote), { x: M, y: 24, size: 7.5, font: this.font, color: MUTED })
  }
  ensure(h: number) {
    if (this.y - h < FOOT) this.newPage()
  }
  heading(text: string) {
    this.ensure(34)
    this.y -= 8
    this.page.drawText(pdfSafe(text).toUpperCase(), { x: M, y: this.y, size: 10, font: this.bold, color: ACCENT })
    this.y -= 4
    this.page.drawLine({ start: { x: M, y: this.y }, end: { x: W - M, y: this.y }, thickness: 0.8, color: LINE })
    this.y -= 14
  }
  text(text: string, opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; indent?: number } = {}) {
    const size = opts.size ?? 9.5
    const font = opts.bold ? this.bold : this.font
    const indent = opts.indent ?? 0
    for (const line of wrap(text, font, size, CW - indent)) {
      this.ensure(size + 4)
      this.page.drawText(line, { x: M + indent, y: this.y, size, font, color: opts.color ?? DARK })
      this.y -= size + 3.5
    }
  }
  gap(n = 6) {
    this.y -= n
  }
}

const label = (key: string) => key

function lines(items: (string | null | undefined)[]): string[] {
  return items.filter((s): s is string => Boolean(s && s.trim()))
}

export async function generateTechnicalQuotePdf(input: TechnicalQuotePdfInput): Promise<Buffer> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const w = new Writer(doc, font, bold, 'Technical quote - not a commercial offer. Pricing is not part of this document unless stated.')
  const d = input.view.draft as Record<string, unknown>
  const diagnosis = (d.diagnosis ?? null) as Diagnosis | null

  // Cabeçalho
  w.page.drawText('TECHNICAL QUOTE', { x: M, y: w.y, size: 20, font: bold, color: DARK })
  const badge = input.approved ? `APPROVED - v${input.version}` : `DRAFT (not approved) - v${input.version}`
  const badgeW = bold.widthOfTextAtSize(badge, 9)
  w.page.drawText(badge, { x: W - M - badgeW, y: w.y + 4, size: 9, font: bold, color: input.approved ? OK : WARN })
  w.y -= 26
  const a = input.appointment
  const when = new Date(a.starts_at).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'long', day: 'numeric', year: 'numeric' })
  w.text(lines([`Work order: ${a.service_order_number ?? '-'}`, a.client_po ? `PO: ${a.client_po}` : null, a.location_name ? `Location: ${a.location_name}` : null, a.address ? `Address: ${a.address}` : null, `Service date: ${when}`]).join('\n'), { size: 10 })

  // Problema
  w.heading(label('Problem description'))
  w.text(diagnosis?.problem_en ?? (d.client_text_en as string | null) ?? 'No description available.')

  // Diagnóstico e evidências (fatos separados de hipóteses)
  if (diagnosis) {
    w.heading('Diagnosis and evidence')
    if (diagnosis.evidence.length > 0) {
      w.text('Confirmed by photos (facts):', { bold: true })
      for (const e of diagnosis.evidence) w.text(`- ${e.fact}  [photo${e.photo_refs.length > 1 ? 's' : ''} ${e.photo_refs.map((n) => n + 1).join(', ')}]`, { indent: 8 })
      w.gap(4)
    }
    if (diagnosis.hypotheses.length > 0) {
      w.text('Hypotheses (not confirmed):', { bold: true })
      for (const h of diagnosis.hypotheses) w.text(`- ${h.text} (${h.confidence} confidence)`, { indent: 8 })
      w.gap(4)
    }
    const idents = lines([diagnosis.identified.brand ? `Brand: ${diagnosis.identified.brand}` : null, diagnosis.identified.model ? `Model: ${diagnosis.identified.model}` : null, diagnosis.identified.part_numbers.length ? `Part numbers read: ${diagnosis.identified.part_numbers.join(', ')}` : null])
    if (idents.length > 0) w.text(`Identified from labels: ${idents.join(' | ')}`)
    else w.text('No brand, model or part number could be confirmed from the photos.', { color: MUTED })
  }

  // Escopo e etapas
  w.heading('Recommended service')
  w.text(diagnosis?.scope_en ?? '-')
  const labor = input.view.labor as Record<string, unknown> | null
  const breakdown = (labor?.breakdown ?? null) as { phase: string; hours: number }[] | null
  if (breakdown && breakdown.length > 0) {
    w.gap(4)
    w.text('Execution steps:', { bold: true })
    breakdown.forEach((b, i) => w.text(`${i + 1}. ${b.phase} (${Number(b.hours).toFixed(2).replace(/\.?0+$/, '')} h)`, { indent: 8 }))
  }

  // Materiais
  const items = input.view.items as Record<string, unknown>[]
  const materials = items.filter((i) => i.kind !== 'tool')
  const tools = items.filter((i) => i.kind === 'tool')
  w.heading('Materials')
  if (materials.length === 0) w.text('No materials listed.', { color: MUTED })
  for (const m of materials) {
    const spec = lines([m.brand ? String(m.brand) : null, m.model ? String(m.model) : null, m.part_number ? `P/N ${m.part_number}` : null, m.dimensions ? String(m.dimensions) : null]).join(' / ')
    w.text(`- ${m.name_en}  x ${m.quantity} ${m.unit}${m.necessity === 'conditional' ? '  (conditional)' : ''}${spec ? `  -  ${spec}` : ''}`)
    if (m.needs_confirmation) w.text(`To confirm: ${m.needs_confirmation}`, { indent: 12, size: 8.5, color: WARN })
    if (input.includeMaterialPrices) {
      const price = m.unit_price_usd ? `USD ${m.unit_price_usd} each, subtotal USD ${m.subtotal_usd}` : 'Price pending'
      w.text(lines([price, m.supplier ? `Supplier: ${m.supplier}` : null, m.product_url ? String(m.product_url) : null]).join('  |  '), { indent: 12, size: 8.5, color: MUTED })
    }
  }
  if (input.includeMaterialPrices) {
    const totals = input.view.totals
    w.gap(4)
    w.text(`Materials total (purchase prices${totals.partial ? ', partial - some prices pending' : ''}): ${totals.materials_usd ? `USD ${totals.materials_usd}` : 'pending'}`, { bold: true })
  }
  if (tools.length > 0) {
    w.gap(4)
    w.text('Tools and special equipment:', { bold: true })
    for (const t of tools) w.text(`- ${t.name_en}${t.quantity && Number(t.quantity) !== 1 ? `  x ${t.quantity}` : ''}`, { indent: 8 })
  }

  // Equipe e horas
  w.heading('Crew and time')
  if (labor) {
    w.text(`Technicians: ${labor.technicians}   |   Service time: ${labor.service_hours} h   |   Total man-hours: ${labor.man_hours} h`, { bold: true })
    if (labor.multi_technician_justification) w.text(`Why more than one technician: ${labor.multi_technician_justification}`)
    if (labor.description_en) w.text(String(labor.description_en))
  } else w.text('Crew and time not estimated yet.', { color: MUTED })

  // Alertas
  const alerts = [...(diagnosis?.safety_risks ?? []).map((r) => `Safety (${r.severity}): ${r.risk}`), ...((d.warnings as string[] | null) ?? []).map((s) => String(s))]
  if (alerts.length > 0) {
    w.heading('Alerts, risks and pending information')
    for (const s of alerts) w.text(`- ${s}`, { color: DARK })
  }

  // Status de aprovação
  w.heading('Technical approval')
  w.text(input.approved ? `Approved by the technician${input.approvedAt ? ` on ${new Date(input.approvedAt).toLocaleDateString('en-US', { timeZone: 'America/New_York' })}` : ''}. Approval of this technical quote does not mean the service was performed or completed.` : 'Not approved yet. This is a draft for technician review.', { color: input.approved ? OK : WARN })

  // Fotografias
  const urls = (input.photoUrls ?? []).slice(0, 8)
  if (urls.length > 0) {
    w.heading('Photos')
    const prepare = input.prepareImage ?? defaultPrepareImage
    const budget = imageBudget(urls.length)
    const imgs = await Promise.all(urls.map((u) => prepare(u, { maxSide: Math.min(budget.maxSide, 900), quality: budget.quality })))
    const cellW = (CW - 14) / 2
    const cellH = 150
    for (let i = 0; i < urls.length; i += 2) {
      w.ensure(cellH + 24)
      for (let c = 0; c < 2 && i + c < urls.length; c += 1) {
        const x = M + c * (cellW + 14)
        const bytes = imgs[i + c]
        const top = w.y
        if (bytes) {
          try {
            const img = bytes.format === 'png' ? await doc.embedPng(bytes.bytes) : await doc.embedJpg(bytes.bytes)
            const scale = Math.min(cellW / img.width, cellH / img.height)
            const iw = img.width * scale
            const ih = img.height * scale
            w.page.drawImage(img, { x: x + (cellW - iw) / 2, y: top - ih, width: iw, height: ih })
            addLinkAnnotation(w.page, urls[i + c]!, { x, y: top - cellH, width: cellW, height: cellH })
          } catch {
            w.page.drawText('image unavailable', { x, y: top - 12, size: 8, font, color: MUTED })
          }
        } else w.page.drawText('image unavailable', { x, y: top - 12, size: 8, font, color: MUTED })
        w.page.drawText(`Photo ${i + c + 1}`, { x, y: top - cellH - 11, size: 8, font, color: MUTED })
      }
      w.y -= cellH + 22
    }
  }

  return Buffer.from(await doc.save())
}
