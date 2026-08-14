import { afterEach, describe, expect, it, vi } from 'vitest'
import { extractAttachmentPdfText } from '@/lib/attachments'

// Item 5 do pedido de 2026-08-14: documentos anexados na biblioteca
// (employee_attachments) nunca eram lidos pelo modelo — buildAttachmentsContext
// só injetava título/instrução de uso, nunca o conteúdo do PDF. Reaproveita a
// MESMA abordagem já usada por extractServiceOrderFromPdf
// (lib/service-orders/extraction.ts): baixa o arquivo, converte pra base64 e
// manda pra OpenAI via content part nativo de arquivo — sem OCR/lib de
// parsing à parte. Mesmo padrão de mock de fetch em sequência do teste
// daquela função (lib/service-orders/__tests__/extraction.test.ts).

function chatCompletionBody(content: unknown) {
  return { choices: [{ message: { content: JSON.stringify(content) } }], usage: { prompt_tokens: 500, completion_tokens: 800 } }
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

describe('extractAttachmentPdfText', () => {
  it('baixa o PDF, converte pra base64 e extrai o texto completo via content part de arquivo', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test')
    const fetchMock = mockFetchSequenceForPdf(chatCompletionBody({ text: 'Cláusula 1: o contrato vale por 12 meses.' }))

    const result = await extractAttachmentPdfText('https://example.com/contrato.pdf', 'contrato.pdf')

    expect(result).toBe('Cláusula 1: o contrato vale por 12 meses.')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const openAiCall = fetchMock.mock.calls[1]!
    const requestBody = JSON.parse(openAiCall[1].body)
    const filePart = requestBody.messages[1].content.find((part: { type: string }) => part.type === 'file')
    expect(filePart.file.filename).toBe('contrato.pdf')
    expect(filePart.file.file_data).toMatch(/^data:application\/pdf;base64,/)
  })

  it('não trava o fluxo (devolve null) quando a OPENAI_API_KEY não está configurada', async () => {
    vi.stubEnv('OPENAI_API_KEY', '')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await extractAttachmentPdfText('https://example.com/contrato.pdf', 'contrato.pdf')

    expect(result).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('não trava o fluxo (devolve null) quando o download do PDF falha', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test')
    const fetchMock = vi.fn(async () => ({ ok: false, status: 404 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await extractAttachmentPdfText('https://example.com/contrato.pdf', 'contrato.pdf')

    expect(result).toBeNull()
  })

  it('não trava o fluxo (devolve null) quando a chamada à OpenAI falha', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test')
    mockFetchSequenceForPdf({ error: { message: 'documento não pôde ser processado' } }, false)

    const result = await extractAttachmentPdfText('https://example.com/contrato.pdf', 'contrato.pdf')

    expect(result).toBeNull()
  })
})
