import { afterEach, describe, expect, it, vi } from 'vitest'
import { embedTexts, generateChatReply, generateImage, generateStructuredReply, synthesizeSpeech, transcribeAudio } from '../openai'

// Fase 14 (observabilidade): nenhuma chamada à OpenAI tinha timeout antes
// disso — uma resposta travada do provedor prendia a requisição
// indefinidamente. Este teste confirma que toda chamada passa um
// AbortSignal pro fetch (não valida o valor exato do timeout — isso é
// interno ao AbortSignal.timeout() e não é inspecionável de fora).

function mockFetchOnce(body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => body,
    arrayBuffer: async () => new ArrayBuffer(4),
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('lib/openai.ts — toda chamada tem timeout (Fase 14)', () => {
  it('generateChatReply passa signal (AbortSignal) pro fetch', async () => {
    const fetchMock = mockFetchOnce({ choices: [{ message: { content: 'oi' } }], usage: {} })
    await generateChatReply({ apiKey: 'k', systemPrompt: 'sp', history: [] })
    const options = fetchMock.mock.calls[0]![1] as RequestInit
    expect(options.signal).toBeInstanceOf(AbortSignal)
  })

  it('generateStructuredReply passa signal (AbortSignal) pro fetch', async () => {
    const fetchMock = mockFetchOnce({ choices: [{ message: { content: '{}' } }], usage: {} })
    await generateStructuredReply({ apiKey: 'k', systemPrompt: 'sp', history: [] })
    const options = fetchMock.mock.calls[0]![1] as RequestInit
    expect(options.signal).toBeInstanceOf(AbortSignal)
  })

  it('generateImage passa signal (AbortSignal) pro fetch', async () => {
    const fetchMock = mockFetchOnce({ data: [{ b64_json: 'abc' }] })
    await generateImage({ apiKey: 'k', prompt: 'um gato' })
    const options = fetchMock.mock.calls[0]![1] as RequestInit
    expect(options.signal).toBeInstanceOf(AbortSignal)
  })

  it('transcribeAudio passa signal (AbortSignal) pro fetch', async () => {
    const fetchMock = mockFetchOnce({ text: 'oi', duration: 1 })
    await transcribeAudio({ apiKey: 'k', base64Audio: Buffer.from('x').toString('base64'), mimeType: 'audio/ogg' })
    const options = fetchMock.mock.calls[0]![1] as RequestInit
    expect(options.signal).toBeInstanceOf(AbortSignal)
  })

  it('synthesizeSpeech passa signal (AbortSignal) pro fetch', async () => {
    const fetchMock = mockFetchOnce({})
    await synthesizeSpeech({ apiKey: 'k', text: 'oi' })
    const options = fetchMock.mock.calls[0]![1] as RequestInit
    expect(options.signal).toBeInstanceOf(AbortSignal)
  })

  it('embedTexts passa signal (AbortSignal) pro fetch', async () => {
    const fetchMock = mockFetchOnce({ data: [{ index: 0, embedding: [0.1] }], usage: {} })
    await embedTexts('k', ['texto'])
    const options = fetchMock.mock.calls[0]![1] as RequestInit
    expect(options.signal).toBeInstanceOf(AbortSignal)
  })
})
