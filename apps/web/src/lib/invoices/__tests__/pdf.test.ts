import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { generateInvoicePdf } from '@/lib/invoices/pdf'

/**
 * pdf-lib comprime os content streams com Flate e escreve o texto como
 * hex string (`<48656C6C6F> Tj`), então nada aparece no buffer bruto —
 * infla cada bloco stream…endstream, decodifica os tokens hex e devolve
 * tudo concatenado para as asserções de conteúdo.
 */
function extractStreamText(buffer: Buffer): string {
  const raw = buffer.toString('latin1') // latin1 = 1 byte por char, índices de string == offsets de byte
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
      out += raw.slice(start, end) // stream não comprimido
    }
  }
  return out.replace(/<([0-9A-Fa-f]+)>/g, (_, hex: string) => Buffer.from(hex, 'hex').toString('latin1'))
}

const baseInvoice = {
  invoice_number: 'INV-0042',
  description: 'Limpeza residencial — julho',
  amount: 350,
  currency: 'USD',
  due_date: '2026-08-10',
  created_at: '2026-07-27T12:00:00.000Z',
  consolidated_items: null,
}

const baseCustomer = {
  name: 'Jane Doe',
  email: 'jane@example.com',
  phone: '+1 480 555 0100',
  address: '123 Desert Rd, Phoenix, AZ',
}

const baseUnit = {
  name: 'Alizo Cleaning',
  billing_company_name: 'Alizo Cleaning LLC',
  billing_address: '456 Main St, Phoenix, AZ',
  billing_email: 'billing@alizocleaning.com',
  billing_phone: '+1 480 555 0199',
  billing_payment_instructions: 'Zelle to pay@alizocleaning.com',
}

describe('generateInvoicePdf', () => {
  it('gera um PDF não vazio e válido', async () => {
    const buffer = await generateInvoicePdf({ invoice: baseInvoice, customer: baseCustomer, unit: baseUnit, locale: 'en' })
    expect(buffer.length).toBeGreaterThan(0)
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-')

    const reloaded = await PDFDocument.load(buffer)
    expect(reloaded.getPageCount()).toBe(1)
  })

  it('inclui os dados de quem cobra, do cliente e da fatura', async () => {
    const buffer = await generateInvoicePdf({ invoice: baseInvoice, customer: baseCustomer, unit: baseUnit, locale: 'en' })
    const raw = extractStreamText(buffer)
    expect(raw).toContain('INV-0042')
    expect(raw).toContain('Alizo Cleaning LLC')
    expect(raw).toContain('Jane Doe')
    expect(raw).toContain('Zelle to pay@alizocleaning.com')
  })

  it('usa units.name quando billing_company_name não está preenchido', async () => {
    const buffer = await generateInvoicePdf({
      invoice: baseInvoice,
      customer: baseCustomer,
      unit: { ...baseUnit, billing_company_name: null },
      locale: 'en',
    })
    expect(extractStreamText(buffer)).toContain('Alizo Cleaning')
  })

  it('lista o detalhamento de uma fatura consolidada', async () => {
    const buffer = await generateInvoicePdf({
      invoice: {
        ...baseInvoice,
        consolidated_items: [
          { invoice_id: 'a', invoice_number: 'INV-0040', description: 'Visita 1', amount: 120, due_date: null },
          { invoice_id: 'b', invoice_number: 'INV-0041', description: 'Visita 2', amount: 230, due_date: null },
        ],
      },
      customer: baseCustomer,
      unit: baseUnit,
      locale: 'en',
    })
    const raw = extractStreamText(buffer)
    expect(raw).toContain('Visita 1')
    expect(raw).toContain('Visita 2')
  })
})
