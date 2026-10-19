import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { generateTechnicalQuotePdf, pdfSafe, type TechnicalQuotePdfInput } from '../pdf'
import { diagnosisFixture } from './helpers'

const view = (overrides: Record<string, unknown> = {}) =>
  ({
    draft: { id: 'd1', status: 'approved', version: 2, technical_check: 'ready_for_review', warnings: ['Confirme o modelo da mola'], diagnosis: diagnosisFixture({ safety_risks: [{ risk: 'Work at height', severity: 'medium' }] }), client_text_en: 'x' },
    items: [
      { id: 'i1', kind: 'material', necessity: 'required', name_en: 'Door closer', quantity: 1, unit: 'ea', brand: null, model: null, part_number: null, dimensions: null, needs_confirmation: 'Check arm length', price_status: 'verified', unit_price_usd: '29.97', subtotal_usd: '29.97', supplier: 'Home Depot', product_url: 'https://www.homedepot.com/p/closer/123' },
      { id: 'i2', kind: 'tool', necessity: 'required', name_en: 'Allen key set', quantity: 1, unit: 'ea', price_status: 'pending', unit_price_usd: null, subtotal_usd: null },
    ],
    options: [],
    labor: { technicians: 2, service_hours: 2, man_hours: 4, multi_technician_justification: 'Heavy glass door', description_en: 'Adjust closer and test.', breakdown: [{ phase: 'Adjust closer', hours: 1.5 }, { phase: 'Test door', hours: 0.5 }] },
    media: [],
    totals: { materials_micros: 29_970_000, materials_usd: '29.97', verified_usd: '29.97', estimated_usd: '0.00', pending_price_count: 0, partial: false },
    ...overrides,
  }) as unknown as TechnicalQuotePdfInput['view']

const input = (over: Partial<TechnicalQuotePdfInput> = {}): TechnicalQuotePdfInput => ({ appointment: { service_order_number: '159959-02', client_po: '5011223', location_name: 'Walgreen Drug Store', address: '805 Val Vista Dr, Gilbert, AZ', starts_at: '2026-10-16T20:00:00Z' }, view: view(), approved: true, approvedAt: '2026-10-18T10:00:00Z', version: 2, ...over })
/** Texto REAL do PDF: os fluxos de conteúdo são comprimidos (Flate) e o texto vai em hexadecimal — sem decodificar, um "não contém" passaria à toa. */
const text = (pdf: Buffer): string => {
  const raw = pdf.toString('latin1')
  let out = ''
  for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let body = m[1]!
    try {
      body = inflateSync(Buffer.from(body, 'latin1')).toString('latin1')
    } catch {
      /* fluxo não comprimido */
    }
    for (const t of body.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) out += `${Buffer.from(t[1]!, 'hex').toString('latin1')}\n`
    for (const t of body.matchAll(/\(((?:[^()\\]|\\.)*)\)\s*Tj/g)) out += `${t[1]}\n`
  }
  return out
}

describe('PDF da cotação técnica', () => {
  it('gera um PDF válido com a WO, o PO, o escopo, as horas-homem e o status de aprovação', async () => {
    const pdf = await generateTechnicalQuotePdf(input())
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    const t = text(pdf)
    expect(t).toContain('159959-02')
    expect(t).toContain('5011223')
    expect(t).toContain('Adjust the door closer.')
    expect(t).toMatch(/Total man-hours: 4/)
    expect(t).toContain('APPROVED')
  })
  it('PADRÃO: sem preços de compra, fornecedor nem link de produto; e nunca nada comercial', async () => {
    const pdf = text(await generateTechnicalQuotePdf(input()))
    expect(pdf).not.toMatch(/29\.97|Home Depot|homedepot\.com/)
    expect(pdf).not.toMatch(/billed|hourly|margin|markup|profit|internal cost|rate card|commercial total/i)
  })
  it('com autorização do admin (includeMaterialPrices) os preços de COMPRA entram; ainda nada comercial', async () => {
    const pdf = text(await generateTechnicalQuotePdf(input({ includeMaterialPrices: true })))
    expect(pdf).toMatch(/29\.97/)
    expect(pdf).not.toMatch(/billed|hourly|margin|markup|profit|internal cost|rate card/i)
  })
  it('rascunho é marcado como não aprovado', async () => {
    const pdf = text(await generateTechnicalQuotePdf(input({ approved: false, approvedAt: null, view: view({ draft: { id: 'd1', status: 'draft', version: 1, warnings: [], diagnosis: diagnosisFixture() } }) })))
    expect(pdf).toMatch(/DRAFT/)
  })
  it('sem diagnóstico/mão de obra/fotos não quebra', async () => {
    const pdf = await generateTechnicalQuotePdf(input({ view: view({ draft: { id: 'd', status: 'draft', version: 1, diagnosis: null, warnings: [] }, items: [], labor: null }), approved: false }))
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
  })
  it('foto indisponível vira "image unavailable" sem derrubar o PDF', async () => {
    const pdf = await generateTechnicalQuotePdf(input({ photoUrls: ['https://x.supabase.co/a.jpg'], prepareImage: async () => null }))
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
  })
  it('pdfSafe troca caracteres que a Helvetica não codifica', () => {
    expect(pdfSafe('“aspas” — travessão • emoji 😀 ação')).toBe('"aspas" - travessão - emoji ?? ação')
  })
})
