import { afterEach, describe, expect, it, vi } from 'vitest'
import { composeClientQuoteDescription } from '../quote-composer'

// composeClientQuoteDescription (2026-09-15, pedido do Vinicius): transforma
// a anotação crua do técnico numa cotação profissional em inglês pro
// cliente final, com tradução em português pra conferência do escritório
// da 360 — bônus, nunca lança, sempre null em qualquer falha/ausência.

function mockFetchOnce(body: unknown, ok = true) {
  const fetchMock = vi.fn(async () => ({ ok, json: async () => body }))
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

    const result = await composeClientQuoteDescription('campainha do estoque quebrada, precisa trocar a peça e o fio')

    expect(result).toEqual({
      en: 'The door bell in the stock room is not working. A replacement unit and wiring are required.',
      pt: 'A campainha do estoque não está funcionando. É necessária uma unidade de reposição e fiação.',
    })
  })

  it('anotação vazia não chama a IA e devolve null', async () => {
    const fetchMock = mockFetchOnce(chatCompletionBody({ quote_en: 'x', quote_pt: 'y' }))
    vi.stubEnv('OPENAI_API_KEY', 'sk-test')

    const result = await composeClientQuoteDescription('   ')

    expect(result).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sem OPENAI_API_KEY devolve null sem chamar a IA', async () => {
    vi.stubEnv('OPENAI_API_KEY', '')
    const fetchMock = mockFetchOnce(chatCompletionBody({ quote_en: 'x', quote_pt: 'y' }))

    const result = await composeClientQuoteDescription('precisa de uma peça nova')

    expect(result).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('falha da OpenAI devolve null, nunca lança', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test')
    mockFetchOnce({ error: { message: 'falhou' } }, false)

    const result = await composeClientQuoteDescription('precisa de uma peça nova')

    expect(result).toBeNull()
  })

  it('resposta incompleta (falta uma das chaves) devolve null', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test')
    mockFetchOnce(chatCompletionBody({ quote_en: 'Only English here.' }))

    const result = await composeClientQuoteDescription('precisa de uma peça nova')

    expect(result).toBeNull()
  })
})
