import { afterEach, describe, expect, it, vi } from 'vitest'
import { summarizeFacilitOrderForTechnician } from '../facilit-summary'
import type { MappedFacilitOrder } from '../facilit'

// summarizeFacilitOrderForTechnician (2026-09-15, pedido do Vinicius):
// resumo em português + dicas pro técnico, gerado por IA a partir do
// escopo em inglês — bônus, nunca bloqueia o sync se faltar a chave ou
// a OpenAI falhar.

function makeOrder(overrides: Partial<MappedFacilitOrder> = {}): MappedFacilitOrder {
  return {
    facilit_order_number: '158725-01',
    po_number: null,
    client_po: null,
    company: 'Walgreen Drug Store #03049',
    address1: null,
    address2: null,
    city: null,
    state: null,
    zip: null,
    phone: null,
    category: 'Electrical',
    order_type: 'Door Bell',
    priority: 'Low',
    status: null,
    requested_at: null,
    visit_date: null,
    latitude: null,
    longitude: null,
    scope: 'STOCK ROOM / ELECTRICAL / DOOR BELL / NOT WORKING',
    raw: {},
    ...overrides,
  }
}

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

describe('summarizeFacilitOrderForTechnician', () => {
  it('devolve o resumo em português quando a IA responde com sucesso', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test')
    mockFetchOnce(chatCompletionBody({ summary_pt: 'Campainha da porta do estoque não funciona. Leve chave de fenda e multímetro.' }))

    const result = await summarizeFacilitOrderForTechnician(makeOrder())

    expect(result).toBe('Campainha da porta do estoque não funciona. Leve chave de fenda e multímetro.')
  })

  it('sem escopo nenhum, não chama a IA e devolve null', async () => {
    const fetchMock = mockFetchOnce(chatCompletionBody({ summary_pt: 'não deveria chegar aqui' }))
    vi.stubEnv('OPENAI_API_KEY', 'sk-test')

    const result = await summarizeFacilitOrderForTechnician(makeOrder({ scope: null }))

    expect(result).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('não trava o sync (devolve null) quando a OPENAI_API_KEY não está configurada', async () => {
    vi.stubEnv('OPENAI_API_KEY', '')
    const fetchMock = mockFetchOnce(chatCompletionBody({ summary_pt: 'não deveria chegar aqui' }))

    const result = await summarizeFacilitOrderForTechnician(makeOrder())

    expect(result).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('não trava o sync (devolve null) quando a chamada à OpenAI falha', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test')
    mockFetchOnce({ error: { message: 'falhou' } }, false)

    const result = await summarizeFacilitOrderForTechnician(makeOrder())

    expect(result).toBeNull()
  })

  it('converte "null" (string) em null, sem inventar resumo', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test')
    mockFetchOnce(chatCompletionBody({ summary_pt: 'null' }))

    const result = await summarizeFacilitOrderForTechnician(makeOrder())

    expect(result).toBeNull()
  })
})
