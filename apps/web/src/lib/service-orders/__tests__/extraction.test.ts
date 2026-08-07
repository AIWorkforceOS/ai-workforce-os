import { afterEach, describe, expect, it, vi } from 'vitest'
import { extractServiceOrderFromImage, isExtractableImageFile } from '../extraction'

function mockFetchOnce(body: unknown, ok = true) {
  const fetchMock = vi.fn(async () => ({ ok, json: async () => body }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function chatCompletionBody(content: unknown) {
  return { choices: [{ message: { content: JSON.stringify(content) } }], usage: { prompt_tokens: 500, completion_tokens: 60 } }
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
