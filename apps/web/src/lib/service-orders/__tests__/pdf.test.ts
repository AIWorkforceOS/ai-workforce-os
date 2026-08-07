import { inflateSync } from 'node:zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { generateServiceOrderPdf } from '../pdf'

/** Mesma técnica de apps/web/src/lib/invoices/__tests__/pdf.test.ts — pdf-lib comprime/hex-codifica o texto, então precisa inflar os streams pra conseguir procurar por conteúdo. */
function extractStreamText(buffer: Buffer): string {
  const raw = buffer.toString('latin1')
  let out = ''
  const streamRegex = /stream\r?\n/g
  let match: RegExpExecArray | null
  while ((match = streamRegex.exec(raw)) !== null) {
    const start = match.index + match[0].length
    const end = raw.indexOf('endstream', start)
    if (end === -1) continue
    try {
      out += inflateSync(buffer.subarray(start, end)).toString('latin1')
    } catch {
      out += raw.slice(start, end)
    }
  }
  return out.replace(/<([0-9A-Fa-f]+)>/g, (_, hex: string) => Buffer.from(hex, 'hex').toString('latin1'))
}

// PNG 1x1 válido, usado como resposta mockada de fetch pra testar o caminho de embed de imagem sem depender de rede.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

async function buildSamplePdfBytes(text: string): Promise<ArrayBuffer> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([400, 500])
  const font = await doc.embedFont(StandardFonts.Helvetica)
  page.drawText(text, { x: 40, y: 400, size: 14, font, color: rgb(0, 0, 0) })
  const bytes = await doc.save()
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

const baseAppointment = {
  service_order_number: 'OS-1001',
  service_order_status: 'completed' as const,
  service_order_summary_pt: 'Trocar fechadura da porta principal.',
  service_order_signed_by: 'Maria Gerente',
  service_order_signed_at: '2026-08-06T14:00:00.000Z',
  service_order_signature_url: null,
  service_order_material_description: null,
  service_order_material_value: null,
  service_order_hours_needed: 2.5,
  service_order_part_purchase_link: null,
  service_order_photos: [],
  service_order_file_url: null,
  service_order_file_name: null,
  address: '123 Desert Rd, Phoenix, AZ',
  starts_at: '2026-08-06T13:00:00.000Z',
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('generateServiceOrderPdf — carimbo na ordem original', () => {
  it('carimba a assinatura/nome/data em cima do PDF original em vez de gerar um resumo', async () => {
    const originalBytes = await buildSamplePdfBytes('ORDEM ORIGINAL MAWI/360')
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('assinatura')) return { ok: true, arrayBuffer: async () => TINY_PNG.buffer.slice(TINY_PNG.byteOffset, TINY_PNG.byteOffset + TINY_PNG.byteLength) } as unknown as Response
        return { ok: true, arrayBuffer: async () => originalBytes } as unknown as Response
      }),
    )

    const buffer = await generateServiceOrderPdf({
      appointment: {
        ...baseAppointment,
        service_order_file_url: 'https://example.com/ordem-original.pdf',
        service_order_file_name: 'ordem-original.pdf',
        service_order_signature_url: 'https://example.com/assinatura.png',
      },
      unitName: 'Alizo Cleaning',
      customerName: 'Loja Mawi 12',
    })

    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    const reloaded = await PDFDocument.load(buffer)
    expect(reloaded.getPageCount()).toBe(1)

    const raw = extractStreamText(buffer)
    expect(raw).toContain('ORDEM ORIGINAL MAWI/360')
    expect(raw).toContain('Maria Gerente')
    expect(raw).toContain('Assinatura do responsável')
    // Não é o resumo gerado à parte — não deve conter o cabeçalho do layout antigo.
    expect(raw).not.toContain('ORDEM DE SERVIÇO')
  })

  it('embute a imagem original como fundo de uma página nova e carimba por cima quando o anexo é uma foto', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, arrayBuffer: async () => TINY_PNG.buffer.slice(TINY_PNG.byteOffset, TINY_PNG.byteOffset + TINY_PNG.byteLength) }) as unknown as Response),
    )

    const buffer = await generateServiceOrderPdf({
      appointment: {
        ...baseAppointment,
        service_order_file_url: 'https://example.com/ordem-original.png',
        service_order_file_name: 'ordem-original.png',
      },
      unitName: 'Alizo Cleaning',
      customerName: 'Loja Mawi 12',
    })

    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    const reloaded = await PDFDocument.load(buffer)
    expect(reloaded.getPageCount()).toBe(1)
    const raw = extractStreamText(buffer)
    expect(raw).toContain('Maria Gerente')
  })

  it('cai pro resumo gerado quando o download do arquivo original falha', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false }) as Response),
    )

    const buffer = await generateServiceOrderPdf({
      appointment: {
        ...baseAppointment,
        service_order_file_url: 'https://example.com/ordem-original.pdf',
        service_order_file_name: 'ordem-original.pdf',
      },
      unitName: 'Alizo Cleaning',
      customerName: 'Loja Mawi 12',
    })

    const raw = extractStreamText(buffer)
    expect(raw).toContain('ORDEM DE SERVIÇO')
    expect(raw).toContain('OS-1001')
  })

  it('cai pro resumo gerado quando o formato do arquivo original não é suportado (ex.: webp)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, arrayBuffer: async () => TINY_PNG.buffer.slice(TINY_PNG.byteOffset, TINY_PNG.byteOffset + TINY_PNG.byteLength) }) as unknown as Response),
    )
    const buffer = await generateServiceOrderPdf({
      appointment: {
        ...baseAppointment,
        service_order_file_url: 'https://example.com/ordem-original.webp',
        service_order_file_name: 'ordem-original.webp',
      },
      unitName: 'Alizo Cleaning',
      customerName: 'Loja Mawi 12',
    })

    const raw = extractStreamText(buffer)
    expect(raw).toContain('ORDEM DE SERVIÇO')
  })
})

describe('generateServiceOrderPdf — resumo de fallback (sem ordem original anexada)', () => {
  it('gera um PDF não vazio e válido só com os campos de texto', async () => {
    const buffer = await generateServiceOrderPdf({ appointment: baseAppointment, unitName: 'Alizo Cleaning', customerName: 'Loja Mawi 12' })
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    const reloaded = await PDFDocument.load(buffer)
    expect(reloaded.getPageCount()).toBeGreaterThanOrEqual(1)
  })

  it('inclui número da ordem, cliente, resumo, horas e quem assinou', async () => {
    const buffer = await generateServiceOrderPdf({ appointment: baseAppointment, unitName: 'Alizo Cleaning', customerName: 'Loja Mawi 12' })
    const raw = extractStreamText(buffer)
    expect(raw).toContain('OS-1001')
    expect(raw).toContain('Loja Mawi 12')
    expect(raw).toContain('Alizo Cleaning')
    expect(raw).toContain('Trocar fechadura da porta principal.')
    expect(raw).toContain('Maria Gerente')
  })

  it('inclui material necessário e valor quando status é cotação', async () => {
    const buffer = await generateServiceOrderPdf({
      appointment: {
        ...baseAppointment,
        service_order_status: 'quote',
        service_order_material_description: 'Fechadura modelo X',
        service_order_material_value: 45.9,
        service_order_part_purchase_link: 'https://loja.com/peca',
      },
      unitName: 'Alizo Cleaning',
      customerName: null,
    })
    const raw = extractStreamText(buffer)
    expect(raw).toContain('Fechadura modelo X')
    expect(raw).toContain('https://loja.com/peca')
  })

  it('não quebra a geração quando a assinatura/fotos não podem ser baixadas (best-effort)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false }) as Response),
    )
    const buffer = await generateServiceOrderPdf({
      appointment: {
        ...baseAppointment,
        service_order_signature_url: 'https://example.invalid/assinatura.png',
        service_order_photos: [
          { url: 'https://example.invalid/foto1.jpg', uploaded_at: '2026-08-06T10:00:00Z', kind: 'service' },
          { url: 'https://example.invalid/nota1.jpg', uploaded_at: '2026-08-06T10:00:00Z', kind: 'material_invoice' },
        ],
      },
      unitName: 'Alizo Cleaning',
      customerName: 'Loja Mawi 12',
    })
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    const raw = extractStreamText(buffer)
    expect(raw).toContain('Fotos do atendimento (1)')
    expect(raw).toContain('Notas fiscais de material (1)')
  })

  it('embute a assinatura e as fotos quando o download funciona', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, arrayBuffer: async () => TINY_PNG.buffer.slice(TINY_PNG.byteOffset, TINY_PNG.byteOffset + TINY_PNG.byteLength) }) as unknown as Response),
    )
    const buffer = await generateServiceOrderPdf({
      appointment: {
        ...baseAppointment,
        service_order_signature_url: 'https://example.com/assinatura.png',
        service_order_photos: [{ url: 'https://example.com/foto1.png', uploaded_at: '2026-08-06T10:00:00Z', kind: 'service' }],
      },
      unitName: 'Alizo Cleaning',
      customerName: 'Loja Mawi 12',
    })
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    const reloaded = await PDFDocument.load(buffer)
    expect(reloaded.getPageCount()).toBeGreaterThanOrEqual(1)
  })

  it('fotos sem kind (dados antigos) contam como foto de atendimento, não nota fiscal', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false }) as Response),
    )
    const buffer = await generateServiceOrderPdf({
      appointment: {
        ...baseAppointment,
        service_order_photos: [{ url: 'https://example.invalid/foto-antiga.jpg', uploaded_at: '2026-08-01T10:00:00Z' }],
      },
      unitName: 'Alizo Cleaning',
      customerName: null,
    })
    const raw = extractStreamText(buffer)
    expect(raw).toContain('Fotos do atendimento (1)')
    expect(raw).not.toContain('Notas fiscais de material')
  })
})
