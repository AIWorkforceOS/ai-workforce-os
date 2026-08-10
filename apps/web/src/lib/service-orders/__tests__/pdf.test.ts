import { deflateSync, inflateSync } from 'node:zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { generateServiceOrderPdf } from '../pdf'

const readFileSyncMock = vi.fn()
vi.mock('node:fs', () => ({
  readFileSync: (...args: unknown[]) => readFileSyncMock(...args),
}))

/** Mesma técnica de apps/web/src/lib/invoices/__tests__/pdf.test.ts — pdf-lib comprime/hex-codifica o texto, então precisa inflar os streams pra conseguir procurar por conteúdo. */
function extractRawStream(buffer: Buffer): string {
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
  return out
}

function extractStreamText(buffer: Buffer): string {
  return extractRawStream(buffer).replace(/<([0-9A-Fa-f]+)>/g, (_, hex: string) => Buffer.from(hex, 'hex').toString('latin1'))
}

/** Acha a posição Y (coordenada da página) onde um texto foi desenhado, via o operador "Tm" que antecede o "Tj" — usado pra provar que o bloco de assinatura se move conforme o conteúdo (posição dinâmica), não uma coordenada fixa. */
function textY(rawStream: string, text: string): number | null {
  const hex = Buffer.from(text, 'latin1').toString('hex')
  const escaped = hex.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(`1 0 0 1 [\\d.]+ ([\\d.]+) Tm\\s*\\n<${escaped}>`, 'i')
  const m = regex.exec(rawStream)
  return m ? parseFloat(m[1]!) : null
}

/** Acha a escala width/height (matriz "cm") aplicada à primeira imagem desenhada — usado pra provar o tamanho real da assinatura embutida. */
function firstImageScale(rawStream: string): { width: number; height: number } | null {
  const regex = /([\d.]+) 0 0 ([\d.]+) 0 0 cm\s*\n1 0 0 1 0 0 cm\s*\n\/Image/
  const m = regex.exec(rawStream)
  return m ? { width: parseFloat(m[1]!), height: parseFloat(m[2]!) } : null
}

/** Acha o x,y de translação (primeiro "cm" antes da rotação/escala) aplicado à primeira imagem desenhada — usado pra provar que a assinatura é centralizada horizontalmente na linha, não mais encostada em MARGIN. */
function firstImagePosition(rawStream: string): { x: number; y: number } | null {
  const regex = /1 0 0 1 ([\d.]+) ([\d.]+) cm\s*\n1 0 0 1 0 0 cm\s*\n[\d.]+ 0 0 [\d.]+ 0 0 cm\s*\n1 0 0 1 0 0 cm\s*\n\/Image/
  const m = regex.exec(rawStream)
  return m ? { x: parseFloat(m[1]!), y: parseFloat(m[2]!) } : null
}

function crc32(buf: Buffer): number {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]!) & 0xff]! ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typeBuf = Buffer.from(type, 'ascii')
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
  return Buffer.concat([len, typeBuf, data, crcBuf])
}

/** Gera um PNG RGB de cor sólida válido, com dimensões arbitrárias — usado pra testar o tamanho real (em pt) que a assinatura ocupa no PDF, coisa que o PNG 1x1 fixo (TINY_PNG) não permite provar (fica sempre travado em escala 1:1). */
function makeSolidPng(width: number, height: number): Buffer {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // color type: RGB
  const rowSize = width * 3 + 1
  const raw = Buffer.alloc(rowSize * height)
  for (let y = 0; y < height; y++) {
    raw[y * rowSize] = 0 // filter: none
    for (let x = 0; x < width; x++) {
      const idx = y * rowSize + 1 + x * 3
      raw[idx] = 20
      raw[idx + 1] = 20
      raw[idx + 2] = 20
    }
  }
  return Buffer.concat([signature, pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))])
}

function stubFetchWithPng(png: Buffer) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, arrayBuffer: async () => png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) }) as unknown as Response),
  )
}

// PNG 1x1 válido, usado como logo mockada em cenários onde o tamanho da imagem não importa.
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
  service_order_scope_en: 'Replace the main door lock.',
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

    const buffer = await generateServiceOrderPdf({ appointment: baseAppointment })

    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    const reloaded = await PDFDocument.load(buffer)
    expect(reloaded.getPageCount()).toBe(1)

    const raw = extractStreamText(buffer)
    // Bloco fixo da contratante (não muda por ordem).
    expect(raw).toContain('360 Service Provider')
    // O rótulo "SERVICE PROVIDER" (caixa alta) abaixo da logo foi removido a pedido do Vinicius —
    // só "360 Service Provider" (caixa mista, dentro do endereço) deve sobrar.
    expect(raw).not.toContain('SERVICE PROVIDER')
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
    // Descrição — em inglês (service_order_scope_en), nunca o resumo em português.
    expect(raw).toContain('SERVICE DESCRIPTION')
    expect(raw).toContain('Scope Of Work')
    expect(raw).toContain('Replace the main door lock.')
    // Bloco de assinatura.
    expect(raw).toContain("Store Manager's Signature")
    expect(raw).toContain('Maria Gerente')
    expect(raw).toContain('Print Name')
    expect(raw).toContain('06/08/2026') // DD/MM/AAAA
    expect(raw).toContain('Date')
    // Store stamp.
    expect(raw).toContain('STORE STAMP')
    expect(raw).toContain('Mandatory')
    // Rodapé — sem nome de unidade (Mawi/Alizo), documento parece 100% da 360.
    expect(raw).toContain('Print Date:')
    expect(raw).toContain('Page 1 of 1')
    expect(raw).not.toContain('Mawi')
    expect(raw).not.toContain('Alizo')
  })

  it('formata a data do atendimento no padrão do documento de referência (M/D/AA hh:mm AM/PM)', async () => {
    readFileSyncMock.mockImplementation(() => {
      throw new Error('ENOENT')
    })
    const buffer = await generateServiceOrderPdf({
      appointment: { ...baseAppointment, starts_at: '2026-08-06T20:30:00.000Z' },
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
    })
    const raw = extractStreamText(buffer)
    expect(raw).toContain('Scope Of Work:')
    expect(raw).toContain('Replace the main door lock.')
    expect(raw).not.toContain('Taina Dias')
    expect(raw).not.toContain('CPO-77')
  })

  it('não desenha nada do bloco de assinatura quando ainda não foi assinada, mas mantém as linhas', async () => {
    readFileSyncMock.mockImplementation(() => {
      throw new Error('ENOENT')
    })
    const buffer = await generateServiceOrderPdf({
      appointment: { ...baseAppointment, service_order_signed_by: null, service_order_signed_at: null, service_order_signature_url: null },
    })
    const raw = extractStreamText(buffer)
    expect(raw).toContain("Store Manager's Signature")
    expect(raw).not.toContain('Maria Gerente')
  })

  it('embute a imagem da assinatura quando o download funciona', async () => {
    readFileSyncMock.mockImplementation(() => {
      throw new Error('ENOENT')
    })
    stubFetchWithPng(TINY_PNG)
    const buffer = await generateServiceOrderPdf({
      appointment: { ...baseAppointment, service_order_signature_url: 'https://example.com/assinatura.png' },
    })
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    const reloaded = await PDFDocument.load(buffer)
    expect(reloaded.getPageCount()).toBe(1)
  })

  it('desenha a assinatura bem maior que antes (largura limitada pela linha, aspecto 3:1)', async () => {
    readFileSyncMock.mockImplementation(() => {
      throw new Error('ENOENT')
    })
    // Imagem 300x100 (aspecto 3:1, parecido com um traço de assinatura real) — o PNG 1x1 fixo (TINY_PNG) sempre
    // fica travado em escala 1:1 e não prova nada sobre o tamanho máximo configurado.
    stubFetchWithPng(makeSolidPng(300, 100))
    const buffer = await generateServiceOrderPdf({
      appointment: { ...baseAppointment, service_order_signature_url: 'https://example.com/assinatura.png' },
    })
    const scale = firstImageScale(extractRawStream(buffer))
    expect(scale).not.toBeNull()
    // Largura máxima (sigLineWidth - 10 = 260pt) é o fator limitante pro aspecto 3:1 → altura ~86.7pt.
    expect(scale!.width).toBeCloseTo(260, 0)
    expect(scale!.height).toBeGreaterThan(80)
  })

  it('respeita a altura máxima aumentada (~140pt) quando a altura, não a largura, é o fator limitante', async () => {
    readFileSyncMock.mockImplementation(() => {
      throw new Error('ENOENT')
    })
    // Imagem estreita e alta (60x300, aspecto 1:5) — aqui é a altura que trava a escala, então esse teste
    // prova diretamente o novo SIGNATURE_IMAGE_MAX_H (140pt), coisa que o teste de aspecto 3:1 acima não cobre
    // (lá quem trava é a largura da linha, então mudar o maxH ali não muda nada).
    stubFetchWithPng(makeSolidPng(60, 300))
    const buffer = await generateServiceOrderPdf({
      appointment: { ...baseAppointment, service_order_signature_url: 'https://example.com/assinatura.png' },
    })
    const scale = firstImageScale(extractRawStream(buffer))
    expect(scale).not.toBeNull()
    expect(scale!.height).toBeCloseTo(140, 0)
    expect(scale!.height).toBeGreaterThan(96) // bem acima do maxH antigo (96pt)
  })

  it('apoia a base da assinatura na linha, não mais flutuando acima dela', async () => {
    readFileSyncMock.mockImplementation(() => {
      throw new Error('ENOENT')
    })
    stubFetchWithPng(makeSolidPng(300, 100))
    const buffer = await generateServiceOrderPdf({
      appointment: { ...baseAppointment, service_order_signature_url: 'https://example.com/assinatura.png' },
    })
    const raw = extractRawStream(buffer)
    const position = firstImagePosition(raw)
    // "Store Manager's Signature" é desenhado em sigLineY - 11 — deriva sigLineY (a coordenada Y
    // da própria linha) a partir dele, sem repetir números mágicos do pdf.ts no teste.
    const labelY = textY(raw, "Store Manager's Signature")
    expect(position).not.toBeNull()
    expect(labelY).not.toBeNull()
    const sigLineY = labelY! + 11
    expect(position!.y).toBeCloseTo(sigLineY, 0)
  })

  it('centraliza a assinatura horizontalmente na linha, não mais encostada em MARGIN', async () => {
    readFileSyncMock.mockImplementation(() => {
      throw new Error('ENOENT')
    })
    const MARGIN = 40
    const SIG_LINE_WIDTH = 270
    // Imagem estreita (60x300) pra deixar uma folga visível na linha e provar que o x não é mais fixo em MARGIN.
    stubFetchWithPng(makeSolidPng(60, 300))
    const buffer = await generateServiceOrderPdf({
      appointment: { ...baseAppointment, service_order_signature_url: 'https://example.com/assinatura.png' },
    })
    const raw = extractRawStream(buffer)
    const scale = firstImageScale(raw)
    const position = firstImagePosition(raw)
    expect(scale).not.toBeNull()
    expect(position).not.toBeNull()
    const expectedX = MARGIN + (SIG_LINE_WIDTH - scale!.width) / 2
    expect(position!.x).toBeCloseTo(expectedX, 0)
    expect(position!.x).toBeGreaterThan(MARGIN) // não mais encostada na margem esquerda
  })

  it('não quebra a geração quando o download da assinatura falha (best-effort)', async () => {
    readFileSyncMock.mockImplementation(() => {
      throw new Error('ENOENT')
    })
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false }) as Response))
    const buffer = await generateServiceOrderPdf({
      appointment: { ...baseAppointment, service_order_signature_url: 'https://example.invalid/assinatura.png' },
    })
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-')
  })

  it('usa a imagem da logo quando o asset já foi colocado no caminho fixo', async () => {
    readFileSyncMock.mockImplementation(() => TINY_PNG)
    const buffer = await generateServiceOrderPdf({ appointment: baseAppointment })
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    const raw = extractStreamText(buffer)
    // Com a imagem real, o placeholder em texto "360" isolado não é desenhado (mas "360" ainda aparece dentro de outros textos, ex. endereço).
    expect(raw).not.toContain('SERVICE PROVIDER\n360')
    expect(raw).toContain('SIGN OFF SHEET')
  })

  it('posiciona o bloco de assinatura logo após o fim do Scope Of Work (dinâmico, não mais uma coordenada fixa e baixa)', async () => {
    readFileSyncMock.mockImplementation(() => {
      throw new Error('ENOENT')
    })
    const shortBuffer = await generateServiceOrderPdf({
      appointment: { ...baseAppointment, service_order_scope_en: 'Short scope of work.' },
    })
    const longerText = Array.from({ length: 45 }, (_, i) => `item-${i}-of-the-scope`).join(' ')
    const longerBuffer = await generateServiceOrderPdf({
      appointment: { ...baseAppointment, service_order_scope_en: longerText },
    })

    // Ambos ainda cabem numa página só — a diferença de posição vem só do texto ser mais longo, não de paginação.
    expect((await PDFDocument.load(shortBuffer)).getPageCount()).toBe(1)
    expect((await PDFDocument.load(longerBuffer)).getPageCount()).toBe(1)

    const shortY = textY(extractRawStream(shortBuffer), "Store Manager's Signature")
    const longerY = textY(extractRawStream(longerBuffer), "Store Manager's Signature")
    expect(shortY).not.toBeNull()
    expect(longerY).not.toBeNull()
    // Descrição mais curta → bloco de assinatura fica mais alto na página (Y maior, mais perto do topo/da descrição).
    expect(shortY!).toBeGreaterThan(longerY!)
  })

  it('pagina o texto de descrição quando ele é longo demais pra uma página, mostrando "Page X of Y" no rodapé', async () => {
    readFileSyncMock.mockImplementation(() => {
      throw new Error('ENOENT')
    })
    const longText = Array.from({ length: 400 }, (_, i) => `paragraph item number ${i} describing the work to be done in detail`).join(' ')
    const buffer = await generateServiceOrderPdf({
      appointment: { ...baseAppointment, service_order_scope_en: longText },
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
