import { afterEach, describe, expect, it, vi } from 'vitest'
import { composeClientQuoteDescription } from '../quote-composer'

// composeClientQuoteDescription (2026-09-15, pedido do Vinicius): transforma
// a anotação crua do técnico num documento de cotação completo em inglês
// pro cliente final, com o mesmo documento traduzido em português pra
// conferência do escritório — bônus, nunca lança, sempre null em qualquer
// falha/ausência. Usado tanto pelo Portal 360 quanto pelo painel do admin.

function mockFetchOnce(body: unknown, ok = true) {
  const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => ({
    ok,
    json: async () => body,
    _capturedBody: init?.body,
  }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function chatCompletionBody(content: unknown) {
  return { choices: [{ message: { content: JSON.stringify(content) } }], usage: { prompt_tokens: 200, completion_tokens: 60 } }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('composeClientQuoteDescription', () => {
  it('devolve inglês + português quando a IA responde com sucesso', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test')
    mockFetchOnce(
      chatCompletionBody({
        quote_en: 'The door bell in the stock room is not working. A replacement unit and wiring are required.',
        quote_pt: 'A campainha do estoque não está funcionando. É necessária uma unidade de reposição e fiação.',
      }),
    )

    const result = await composeClientQuoteDescription({ technicianNotes: 'campainha do estoque quebrada, precisa trocar a peça e o fio' })

    expect(result).toEqual({
      en: 'The door bell in the stock room is not working. A replacement unit and wiring are required.',
      pt: 'A campainha do estoque não está funcionando. É necessária uma unidade de reposição e fiação.',
    })
  })

  it('leva local, PO#, custo, horas e link do material pro contexto enviado à IA', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test')
    const fetchMock = mockFetchOnce(chatCompletionBody({ quote_en: 'x', quote_pt: 'y' }))

    await composeClientQuoteDescription({
      technicianNotes: 'precisa trocar a fechadura',
      locationName: 'Walgreens #03049',
      orderNumber: '158088-01',
      materialValue: 45.9,
      hoursNeeded: 2,
      partPurchaseLink: 'https://loja.com/fechadura',
    })

    const call = fetchMock.mock.calls[0]!
    const requestBody = JSON.parse((call[1] as RequestInit).body as string)
    const userMessage = requestBody.messages.find((m: { role: string }) => m.role === 'user').content
    expect(userMessage).toContain('Walgreens #03049')
    expect(userMessage).toContain('158088-01')
    expect(userMessage).toContain('45.90')
    expect(userMessage).toContain('2h')
    expect(userMessage).toContain('https://loja.com/fechadura')
  })

  it('anotação vazia não chama a IA e devolve null', async () => {
    const fetchMock = mockFetchOnce(chatCompletionBody({ quote_en: 'x', quote_pt: 'y' }))
    vi.stubEnv('OPENAI_API_KEY', 'sk-test')

    const result = await composeClientQuoteDescription({ technicianNotes: '   ' })

    expect(result).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sem OPENAI_API_KEY devolve null sem chamar a IA', async () => {
    vi.stubEnv('OPENAI_API_KEY', '')
    const fetchMock = mockFetchOnce(chatCompletionBody({ quote_en: 'x', quote_pt: 'y' }))

    const result = await composeClientQuoteDescription({ technicianNotes: 'precisa de uma peça nova' })

    expect(result).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('falha da OpenAI devolve null, nunca lança', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test')
    mockFetchOnce({ error: { message: 'falhou' } }, false)

    const result = await composeClientQuoteDescription({ technicianNotes: 'precisa de uma peça nova' })

    expect(result).toBeNull()
  })

  it('resposta incompleta (falta uma das chaves) devolve null', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test')
    mockFetchOnce(chatCompletionBody({ quote_en: 'Only English here.' }))

    const result = await composeClientQuoteDescription({ technicianNotes: 'precisa de uma peça nova' })

    expect(result).toBeNull()
  })
})
