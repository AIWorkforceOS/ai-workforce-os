import { afterEach, describe, expect, it, vi } from 'vitest'

const generateStructuredReplyFromPdf = vi.fn()
const generateStructuredReplyFromImage = vi.fn()
const getOpenAIApiKey = vi.fn()

vi.mock('@/lib/openai', () => ({
  generateStructuredReplyFromPdf: (...args: unknown[]) => generateStructuredReplyFromPdf(...args),
  generateStructuredReplyFromImage: (...args: unknown[]) => generateStructuredReplyFromImage(...args),
  getOpenAIApiKey: (...args: unknown[]) => getOpenAIApiKey(...args),
}))

import { detectSignatureFieldsFromImage, detectSignatureFieldsFromPdf } from '../signature-fields'

afterEach(() => {
  vi.clearAllMocks()
})

describe('detectSignatureFieldsFromPdf', () => {
  it('devolve null sem chamar a OpenAI quando não há API key configurada', async () => {
    getOpenAIApiKey.mockReturnValue(null)
    const result = await detectSignatureFieldsFromPdf({ fileName: 'ordem.pdf', base64Pdf: 'AA==', pageCount: 2 })
    expect(result).toBeNull()
    expect(generateStructuredReplyFromPdf).not.toHaveBeenCalled()
  })

  it('devolve as coordenadas normalizadas e a página onde os campos foram encontrados', async () => {
    getOpenAIApiKey.mockReturnValue('sk-test')
    generateStructuredReplyFromPdf.mockResolvedValue({
      page_number: 2,
      signature: { x: 0.6, y: 0.85 },
      print_name: { x: 0.6, y: 0.9 },
      date: { x: 0.85, y: 0.9 },
    })
    const result = await detectSignatureFieldsFromPdf({ fileName: 'ordem.pdf', base64Pdf: 'AA==', pageCount: 2 })
    expect(result).toEqual({
      pageNumber: 2,
      signature: { xFrac: 0.6, yFrac: 0.85 },
      printName: { xFrac: 0.6, yFrac: 0.9 },
      date: { xFrac: 0.85, yFrac: 0.9 },
    })
  })

  it('descarta pontos fora do intervalo 0..1 (não invade box fixo) mas mantém os demais válidos', async () => {
    getOpenAIApiKey.mockReturnValue('sk-test')
    generateStructuredReplyFromPdf.mockResolvedValue({
      page_number: 1,
      signature: { x: 1.4, y: 0.5 },
      print_name: { x: 0.5, y: 0.9 },
      date: null,
    })
    const result = await detectSignatureFieldsFromPdf({ fileName: 'ordem.pdf', base64Pdf: 'AA==', pageCount: 1 })
    expect(result?.signature).toBeNull()
    expect(result?.printName).toEqual({ xFrac: 0.5, yFrac: 0.9 })
    expect(result?.date).toBeNull()
  })

  it('descarta pontos não numéricos sem lançar erro', async () => {
    getOpenAIApiKey.mockReturnValue('sk-test')
    generateStructuredReplyFromPdf.mockResolvedValue({
      page_number: 1,
      signature: { x: 'meio', y: 0.5 },
      print_name: { x: 0.5, y: 0.9 },
      date: undefined,
    })
    const result = await detectSignatureFieldsFromPdf({ fileName: 'ordem.pdf', base64Pdf: 'AA==', pageCount: 1 })
    expect(result?.signature).toBeNull()
    expect(result?.printName).toEqual({ xFrac: 0.5, yFrac: 0.9 })
  })

  it('cai pra última página quando page_number vem fora do intervalo ou ausente', async () => {
    getOpenAIApiKey.mockReturnValue('sk-test')
    generateStructuredReplyFromPdf.mockResolvedValue({ signature: { x: 0.5, y: 0.9 } })
    const result = await detectSignatureFieldsFromPdf({ fileName: 'ordem.pdf', base64Pdf: 'AA==', pageCount: 3 })
    expect(result?.pageNumber).toBe(3)

    generateStructuredReplyFromPdf.mockResolvedValue({ page_number: 99, signature: { x: 0.5, y: 0.9 } })
    const result2 = await detectSignatureFieldsFromPdf({ fileName: 'ordem.pdf', base64Pdf: 'AA==', pageCount: 3 })
    expect(result2?.pageNumber).toBe(3)
  })

  it('devolve null quando nenhum dos 3 campos foi localizado', async () => {
    getOpenAIApiKey.mockReturnValue('sk-test')
    generateStructuredReplyFromPdf.mockResolvedValue({ page_number: 1, signature: null, print_name: null, date: null })
    const result = await detectSignatureFieldsFromPdf({ fileName: 'ordem.pdf', base64Pdf: 'AA==', pageCount: 1 })
    expect(result).toBeNull()
  })

  it('devolve null (best-effort) quando a chamada à IA falha', async () => {
    getOpenAIApiKey.mockReturnValue('sk-test')
    generateStructuredReplyFromPdf.mockRejectedValue(new Error('timeout'))
    const result = await detectSignatureFieldsFromPdf({ fileName: 'ordem.pdf', base64Pdf: 'AA==', pageCount: 1 })
    expect(result).toBeNull()
  })

  it('devolve null quando a resposta da IA não é um objeto válido', async () => {
    getOpenAIApiKey.mockReturnValue('sk-test')
    generateStructuredReplyFromPdf.mockResolvedValue(null)
    const result = await detectSignatureFieldsFromPdf({ fileName: 'ordem.pdf', base64Pdf: 'AA==', pageCount: 1 })
    expect(result).toBeNull()
  })
})

describe('detectSignatureFieldsFromImage', () => {
  it('força página 1 mesmo que o modelo devolva outro número (documento de página única)', async () => {
    getOpenAIApiKey.mockReturnValue('sk-test')
    generateStructuredReplyFromImage.mockResolvedValue({ page_number: 5, signature: { x: 0.5, y: 0.8 } })
    const result = await detectSignatureFieldsFromImage({ imageUrl: 'https://example.com/ordem.png' })
    expect(result?.pageNumber).toBe(1)
  })

  it('devolve null sem chamar a OpenAI quando não há API key', async () => {
    getOpenAIApiKey.mockReturnValue(null)
    const result = await detectSignatureFieldsFromImage({ imageUrl: 'https://example.com/ordem.png' })
    expect(result).toBeNull()
    expect(generateStructuredReplyFromImage).not.toHaveBeenCalled()
  })

  it('devolve null (best-effort) quando a chamada à IA falha', async () => {
    getOpenAIApiKey.mockReturnValue('sk-test')
    generateStructuredReplyFromImage.mockRejectedValue(new Error('erro de rede'))
    const result = await detectSignatureFieldsFromImage({ imageUrl: 'https://example.com/ordem.png' })
    expect(result).toBeNull()
  })
})
