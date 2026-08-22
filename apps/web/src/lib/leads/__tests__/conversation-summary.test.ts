import { describe, expect, it, vi } from 'vitest'
import { formatTranscript } from '@/lib/leads/conversation-summary'

describe('formatTranscript', () => {
  it('rotula inbound como contato e outbound como agente, na ordem recebida', () => {
    const text = formatTranscript([
      { direction: 'outbound', content: 'Olá! Como posso ajudar?' },
      { direction: 'inbound', content: 'Quero saber o preço' },
    ])
    expect(text).toBe('[agente] Olá! Como posso ajudar?\n[contato] Quero saber o preço')
  })

  it('lista vazia vira string vazia', () => {
    expect(formatTranscript([])).toBe('')
  })
})

describe('summarizeConversation', () => {
  it('usa generateStructuredReply e cai num intent padrão quando o modelo não devolve um', async () => {
    vi.resetModules()
    vi.doMock('@/lib/openai', () => ({
      generateStructuredReply: vi.fn(async () => ({ summary: 'Cliente perguntou sobre horários.' })),
    }))
    const { summarizeConversation } = await import('@/lib/leads/conversation-summary')

    const result = await summarizeConversation({ apiKey: 'fake', transcript: '[contato] oi' })
    expect(result).toEqual({ summary: 'Cliente perguntou sobre horários.', intent: 'não identificada' })
  })
})
