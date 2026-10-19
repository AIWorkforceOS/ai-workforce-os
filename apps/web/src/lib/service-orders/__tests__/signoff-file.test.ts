import { describe, expect, it } from 'vitest'
import { filenameFromContentDisposition, hasSignedSignOff, looksLikePdf, signOffFileName } from '../signoff-file'

describe('nome do arquivo do Sign Off', () => {
  it('SignOff_PO-<número>-<data>.pdf, usando o PO do cliente quando existe', () => {
    expect(signOffFileName({ clientPo: '161088-02', orderNumber: '6224247', dateIso: '2026-10-13T13:00:00.000Z' })).toBe('SignOff_PO-161088-02-2026-10-13.pdf')
  })
  it('sem PO usa o número da ordem; sem nada usa o começo do id', () => {
    expect(signOffFileName({ orderNumber: '6224247', dateIso: '2026-10-13T13:00:00.000Z' })).toBe('SignOff_PO-6224247-2026-10-13.pdf')
    expect(signOffFileName({ fallbackId: '94fd09d0-fd50-490c-b3a8', dateIso: '2026-10-13T13:00:00.000Z' })).toBe('SignOff_PO-94fd09d0-2026-10-13.pdf')
  })
  it('remove caracteres que quebram em Arquivos/WhatsApp e usa a data do fuso da operação (não UTC)', () => {
    expect(signOffFileName({ clientPo: ' PO/16 10:88 ', dateIso: '2026-10-14T02:30:00.000Z' })).toBe('SignOff_PO-PO_16_10_88-2026-10-13.pdf')
  })
  it('data inválida não quebra', () => {
    expect(signOffFileName({ orderNumber: '1', dateIso: 'x' })).toBe('SignOff_PO-1-sem-data.pdf')
  })
})

describe('cabeçalho e validação do PDF', () => {
  it('lê o nome do Content-Disposition e rejeita nomes suspeitos', () => {
    expect(filenameFromContentDisposition('attachment; filename="SignOff_PO-1-2026-10-13.pdf"')).toBe('SignOff_PO-1-2026-10-13.pdf')
    expect(filenameFromContentDisposition('attachment; filename="../x.pdf"')).toBeNull()
    expect(filenameFromContentDisposition(null)).toBeNull()
  })
  it('só aceita bytes de um PDF de verdade', () => {
    const pdf = new Uint8Array(2000)
    pdf.set([0x25, 0x50, 0x44, 0x46, 0x2d])
    expect(looksLikePdf(pdf)).toBe(true)
    expect(looksLikePdf(new TextEncoder().encode('{"error":"x"}'))).toBe(false)
    expect(looksLikePdf(new Uint8Array(2000))).toBe(false)
  })
})

describe('quando mostrar Baixar Sign Off', () => {
  const base = { service_order_signature_url: 'https://x/assinatura.png', service_order_signed_by: 'Jaime Hughes' }
  it('ordem assinada, Finalizada OU em Cotação: mostra (o PDF é o mesmo Sign Off Sheet)', () => {
    expect(hasSignedSignOff({ ...base, service_order_status: 'completed' })).toBe(true)
    expect(hasSignedSignOff({ ...base, service_order_status: 'quote' })).toBe(true)
  })
  it('pendente, sem assinatura ou sem nome de quem assinou: não mostra', () => {
    expect(hasSignedSignOff({ ...base, service_order_status: 'pending' })).toBe(false)
    expect(hasSignedSignOff({ ...base, service_order_status: 'completed', service_order_signature_url: null })).toBe(false)
    expect(hasSignedSignOff({ ...base, service_order_status: 'completed', service_order_signed_by: '  ' })).toBe(false)
  })
})
