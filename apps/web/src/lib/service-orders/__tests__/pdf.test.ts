import { inflateSync } from 'node:zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { generateServiceOrderPdf } from '../pdf'

const readFileSyncMock = vi.fn()
vi.mock('node:fs', () => ({
  readFileSync: (...args: unknown[]) => readFileSyncMock(...args),
}))

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

// PNG 1x1 válido, usado tanto como logo mockada quanto como resposta de fetch da assinatura.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

const baseAppointment = {
  service_order_number: 'OS-1001',
  service_order_client_po: 'CPO-77',
  service_order_priority: 'Low',
  service_order_order_type: 'Interior',
  service_order_ivr_pin: '19471464',
  service_order_location_name: 'PB - Tanger - Loc # 6800',
  service_order_location_phone: '305-555-0101',
  service_order_issuer_name: 'Taina Dias',
  service_order_issuer_email: 'taina@360serviceprovider.com',
  service_order_summary_pt: 'Trocar fechadura da porta principal.',
  service_order_signed_by: 'Maria Gerente',
  service_order_signed_at: '2026-08-06T14:00:00.000Z',
  service_order_signature_url: null as string | null,
  address: '123 Desert Rd, Phoenix, AZ',
  starts_at: '2026-08-06T13:00:00.000Z',
}

afterEach(() => {
  vi.unstubAllGlobals()
  readFileSyncMock.mockReset()
})

describe('generateServiceOrderPdf — Sign Off Sheet fixo', () => {
  it('gera um PDF válido de uma página com os campos fixos e dinâmicos do template', async () => {
    readFileSyncMock.mockImplementation(() => {
      throw new Error('ENOENT')
    })

    const buffer = await generateServiceOrderPdf({ appointment: baseAppointment, unitName: 'Alizo Cleaning' })

    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    const reloaded = await PDFDocument.load(buffer)
    expect(reloaded.getPageCount()).toBe(1)

    const raw = extractStreamText(buffer)
    // Bloco fixo da contratante (não muda por ordem).
    expect(raw).toContain('360 Service Provider')
    expect(raw).toContain('11098 Biscayne Boulevard, Suite 305')
    expect(raw).toContain('Miami, FL 33161')
    expect(raw).toContain('Phone # 786-281-3413')
    // Título + Vendor PO #.
    expect(raw).toContain('SIGN OFF SHEET')
    expect(raw).toContain('VENDOR PO #')
    expect(raw).toContain('OS-1001')
    // Campos dinâmicos do cabeçalho direito.
    expect(raw).toContain('CPO-77')
    expect(raw).toContain('Low')
    expect(raw).toContain('Interior')
    expect(raw).toContain('Taina Dias')
    expect(raw).toContain('taina@360serviceprovider.com')
    // Local + IVR.
    expect(raw).toContain('SERVICE LOCATION')
    expect(raw).toContain('PB - Tanger - Loc # 6800')
    expect(raw).toContain('123 Desert Rd, Phoenix, AZ')
    expect(raw).toContain('305-555-0101')
    expect(raw).toContain('IVR Pin #')
    expect(raw).toContain('19471464')
    // Descrição.
    expect(raw).toContain('SERVICE DESCRIPTION')
    expect(raw).toContain('Scope Of Work')
    expect(raw).toContain('Trocar fechadura da porta principal.')
    // Bloco de assinatura.
    expect(raw).toContain("Store Manager's Signature")
    expect(raw).toContain('Maria Gerente')
    expect(raw).toContain('Print Name')
    expect(raw).toContain('06/08/2026') // DD/MM/AAAA
    expect(raw).toContain('Date')
    // Store stamp.
    expect(raw).toContain('STORE STAMP')
    expect(raw).toContain('Mandatory')
    // Rodapé.
    expect(raw).toContain('Print Date:')
    expect(raw).toContain('Page 1 of 1')
    expect(raw).toContain('Alizo Cleaning')
  })

  it('formata a data do atendimento no padrão do documento de referência (M/D/AA hh:mm AM/PM)', async () => {
    readFileSyncMock.mockImplementation(() => {
      throw new Error('ENOENT')
    })
    const buffer = await generateServiceOrderPdf({
      appointment: { ...baseAppointment, starts_at: '2026-08-06T20:30:00.000Z' },
      unitName: 'Alizo Cleaning',
    })
    const raw = extractStreamText(buffer)
    expect(raw).toContain('8/6/26')
  })

  it('usa "—" como placeholder pros campos dinâmicos não preenchidos', async () => {
    readFileSyncMock.mockImplementation(() => {
      throw new Error('ENOENT')
    })
    const buffer = await generateServiceOrderPdf({
      appointment: {
        ...baseAppointment,
        service_order_number: null,
        service_order_client_po: null,
        service_order_priority: null,
        service_order_order_type: null,
        service_order_ivr_pin: null,
        service_order_issuer_name: null,
        service_order_issuer_email: null,
      },
      unitName: 'Alizo Cleaning',
    })
    const raw = extractStreamText(buffer)
    expect(raw).toContain('Scope Of Work:')
    expect(raw).toContain('Trocar fechadura da porta principal.')
    expect(raw).not.toContain('Taina Dias')
    expect(raw).not.toContain('CPO-77')
  })

  it('não desenha nada do bloco de assinatura quando ainda não foi assinada, mas mantém as linhas', async () => {
    readFileSyncMock.mockImplementation(() => {
      throw new Error('ENOENT')
    })
    const buffer = await generateServiceOrderPdf({
      appointment: { ...baseAppointment, service_order_signed_by: null, service_order_signed_at: null, service_order_signature_url: null },
      unitName: 'Alizo Cleaning',
    })
    const raw = extractStreamText(buffer)
    expect(raw).toContain("Store Manager's Signature")
    expect(raw).not.toContain('Maria Gerente')
  })

  it('embute a imagem da assinatura quando o download funciona', async () => {
    readFileSyncMock.mockImplementation(() => {
      throw new Error('ENOENT')
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, arrayBuffer: async () => TINY_PNG.buffer.slice(TINY_PNG.byteOffset, TINY_PNG.byteOffset + TINY_PNG.byteLength) }) as unknown as Response),
    )
    const buffer = await generateServiceOrderPdf({
      appointment: { ...baseAppointment, service_order_signature_url: 'https://example.com/assinatura.png' },
      unitName: 'Alizo Cleaning',
    })
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    const reloaded = await PDFDocument.load(buffer)
    expect(reloaded.getPageCount()).toBe(1)
  })

  it('não quebra a geração quando o download da assinatura falha (best-effort)', async () => {
    readFileSyncMock.mockImplementation(() => {
      throw new Error('ENOENT')
    })
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false }) as Response))
    const buffer = await generateServiceOrderPdf({
      appointment: { ...baseAppointment, service_order_signature_url: 'https://example.invalid/assinatura.png' },
      unitName: 'Alizo Cleaning',
    })
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-')
  })

  it('usa a imagem da logo quando o asset já foi colocado no caminho fixo', async () => {
    readFileSyncMock.mockImplementation(() => TINY_PNG)
    const buffer = await generateServiceOrderPdf({ appointment: baseAppointment, unitName: 'Alizo Cleaning' })
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    const raw = extractStreamText(buffer)
    // Com a imagem real, o placeholder em texto "360" isolado não é desenhado (mas "360" ainda aparece dentro de outros textos, ex. endereço).
    expect(raw).not.toContain('SERVICE PROVIDER\n360')
    expect(raw).toContain('SIGN OFF SHEET')
  })

  it('pagina o texto de descrição quando ele é longo demais pra uma página, mostrando "Page X of Y" no rodapé', async () => {
    readFileSyncMock.mockImplementation(() => {
      throw new Error('ENOENT')
    })
    const longText = Array.from({ length: 400 }, (_, i) => `parágrafo item número ${i} descrevendo o trabalho a ser feito em detalhe`).join(' ')
    const buffer = await generateServiceOrderPdf({
      appointment: { ...baseAppointment, service_order_summary_pt: longText },
      unitName: 'Alizo Cleaning',
    })
    const reloaded = await PDFDocument.load(buffer)
    expect(reloaded.getPageCount()).toBeGreaterThan(1)
    const raw = extractStreamText(buffer)
    expect(raw).toContain(`Page 1 of ${reloaded.getPageCount()}`)
    expect(raw).toContain(`Page ${reloaded.getPageCount()} of ${reloaded.getPageCount()}`)
    expect(raw).toContain('Scope Of Work (cont.)')
    // O bloco de assinatura ainda aparece (só na última página).
    expect(raw).toContain("Store Manager's Signature")
    expect(raw).toContain('Maria Gerente')
  })
})
