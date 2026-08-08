import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  extractServiceOrderFromImage,
  extractServiceOrderFromPdf,
  isExtractableAttachment,
  isExtractableImageFile,
  isExtractablePdfFile,
} from '../extraction'

function mockFetchOnce(body: unknown, ok = true) {
  const fetchMock = vi.fn(async () => ({ ok, json: async () => body }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function chatCompletionBody(content: unknown) {
  return { choices: [{ message: { content: JSON.stringify(content) } }], usage: { prompt_tokens: 500, completion_tokens: 60 } }
}

/** Duas chamadas fetch em sequência: 1ª baixa o PDF do Storage, 2ª chama a OpenAI. */
function mockFetchSequenceForPdf(chatBody: unknown, chatOk = true) {
  const fetchMock = vi
    .fn()
    .mockImplementationOnce(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }))
    .mockImplementationOnce(async () => ({ ok: chatOk, json: async () => chatBody }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('isExtractableImageFile', () => {
  it('reconhece extensões de imagem suportadas', () => {
    expect(isExtractableImageFile('ordem-360.jpg')).toBe(true)
    expect(isExtractableImageFile('ordem-360.JPEG')).toBe(true)
    expect(isExtractableImageFile('foto.png')).toBe(true)
    expect(isExtractableImageFile('print.webp')).toBe(true)
  })

  it('não trata PDF (nem outros formatos) como extraível por visão', () => {
    expect(isExtractableImageFile('ordem-360.pdf')).toBe(false)
    expect(isExtractableImageFile('ordem-360')).toBe(false)
    expect(isExtractableImageFile('ordem.docx')).toBe(false)
  })
})

describe('isExtractablePdfFile / isExtractableAttachment', () => {
  it('reconhece PDF como extraível (documento nativo, sem OCR)', () => {
    expect(isExtractablePdfFile('ordem-360.pdf')).toBe(true)
    expect(isExtractablePdfFile('ORDEM.PDF')).toBe(true)
    expect(isExtractablePdfFile('ordem.jpg')).toBe(false)
  })

  it('isExtractableAttachment aceita imagem ou PDF, rejeita outros formatos', () => {
    expect(isExtractableAttachment('ordem.jpg')).toBe(true)
    expect(isExtractableAttachment('ordem.pdf')).toBe(true)
    expect(isExtractableAttachment('ordem.docx')).toBe(false)
  })
})

describe('extractServiceOrderFromImage', () => {
  it('extrai resumo em PT, endereço e número da ordem quando a IA responde com sucesso', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test')
    mockFetchOnce(
      chatCompletionBody({
        summary_pt: 'Trocar a fechadura da porta dos fundos e verificar o batente.',
        address: '123 Main St, Phoenix, AZ',
        order_number: '132617',
      }),
    )

    const result = await extractServiceOrderFromImage('https://example.com/ordem.jpg')

    expect(result).toEqual({
      summaryPt: 'Trocar a fechadura da porta dos fundos e verificar o batente.',
      address: '123 Main St, Phoenix, AZ',
      orderNumber: '132617',
      clientPo: null,
      priority: null,
      orderType: null,
      ivrPin: null,
      locationName: null,
      locationPhone: null,
      issuerName: null,
      issuerEmail: null,
    })
  })

  it('extrai todos os campos do Sign Off Sheet quando a IA os localiza no documento', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test')
    mockFetchOnce(
      chatCompletionBody({
        summary_pt: 'Texto completo do escopo do trabalho, conforme impresso no documento.',
        address: '123 Main St, Phoenix, AZ',
        order_number: '132617',
        client_po: 'CPO-77',
        priority: 'Low',
        order_type: 'Interior',
        ivr_pin: '19471464',
        location_name: 'PB - Tanger - Loc # 6800',
        location_phone: '305-555-0101',
        issuer_name: 'Taina Dias',
        issuer_email: 'taina@360serviceprovider.com',
      }),
    )

    const result = await extractServiceOrderFromImage('https://example.com/ordem.jpg')

    expect(result).toEqual({
      summaryPt: 'Texto completo do escopo do trabalho, conforme impresso no documento.',
      address: '123 Main St, Phoenix, AZ',
      orderNumber: '132617',
      clientPo: 'CPO-77',
      priority: 'Low',
      orderType: 'Interior',
      ivrPin: '19471464',
      locationName: 'PB - Tanger - Loc # 6800',
      locationPhone: '305-555-0101',
      issuerName: 'Taina Dias',
      issuerEmail: 'taina@360serviceprovider.com',
    })
  })

  it('converte campos "null" (string ou ausentes) em null, sem inventar dado', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test')
    mockFetchOnce(chatCompletionBody({ summary_pt: 'Serviço de pintura no corredor.', address: 'null' }))

    const result = await extractServiceOrderFromImage('https://example.com/ordem.jpg')

    expect(result).toEqual({
      summaryPt: 'Serviço de pintura no corredor.',
      address: null,
      orderNumber: null,
      clientPo: null,
      priority: null,
      orderType: null,
      ivrPin: null,
      locationName: null,
      locationPhone: null,
      issuerName: null,
      issuerEmail: null,
    })
  })

  it('não trava o fluxo (devolve null) quando a OPENAI_API_KEY não está configurada', async () => {
    vi.stubEnv('OPENAI_API_KEY', '')
    const fetchMock = mockFetchOnce(chatCompletionBody({ summary_pt: 'não deveria chegar aqui' }))

    const result = await extractServiceOrderFromImage('https://example.com/ordem.jpg')

    expect(result).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('não trava o fluxo (devolve null) quando a chamada à OpenAI falha', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test')
    mockFetchOnce({ error: { message: 'imagem não pôde ser processada' } }, false)

    const result = await extractServiceOrderFromImage('https://example.com/ordem.jpg')

    expect(result).toBeNull()
  })

  it('não trava o fluxo (devolve null) quando a resposta não é um JSON válido', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test')
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'isso não é JSON' } }], usage: {} }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await extractServiceOrderFromImage('https://example.com/ordem.jpg')

    expect(result).toBeNull()
  })
})

describe('extractServiceOrderFromPdf', () => {
  it('baixa o PDF, converte pra base64 e extrai os dados via content part de arquivo', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test')
    const fetchMock = mockFetchSequenceForPdf(
      chatCompletionBody({
        summary_pt: 'Trocar a fechadura da porta dos fundos.',
        address: '123 Main St, Phoenix, AZ',
        order_number: '132617',
      }),
    )

    const result = await extractServiceOrderFromPdf('https://example.com/ordem.pdf', 'ordem-360.pdf')

    expect(result).toEqual({
      summaryPt: 'Trocar a fechadura da porta dos fundos.',
      address: '123 Main St, Phoenix, AZ',
      orderNumber: '132617',
      clientPo: null,
      priority: null,
      orderType: null,
      ivrPin: null,
      locationName: null,
      locationPhone: null,
      issuerName: null,
      issuerEmail: null,
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const openAiCall = fetchMock.mock.calls[1]!
    const requestBody = JSON.parse(openAiCall[1].body)
    const filePart = requestBody.messages[1].content.find((part: { type: string }) => part.type === 'file')
    expect(filePart.file.filename).toBe('ordem-360.pdf')
    expect(filePart.file.file_data).toMatch(/^data:application\/pdf;base64,/)
  })

  it('não trava o fluxo (devolve null) quando a OPENAI_API_KEY não está configurada', async () => {
    vi.stubEnv('OPENAI_API_KEY', '')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await extractServiceOrderFromPdf('https://example.com/ordem.pdf', 'ordem.pdf')

    expect(result).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('não trava o fluxo (devolve null) quando o download do PDF falha', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test')
    const fetchMock = vi.fn(async () => ({ ok: false, status: 404 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await extractServiceOrderFromPdf('https://example.com/ordem.pdf', 'ordem.pdf')

    expect(result).toBeNull()
  })

  it('não trava o fluxo (devolve null) quando a chamada à OpenAI falha', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test')
    mockFetchSequenceForPdf({ error: { message: 'documento não pôde ser processado' } }, false)

    const result = await extractServiceOrderFromPdf('https://example.com/ordem.pdf', 'ordem.pdf')

    expect(result).toBeNull()
  })
})
