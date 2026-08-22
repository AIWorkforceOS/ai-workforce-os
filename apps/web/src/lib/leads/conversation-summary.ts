import { generateStructuredReply, type ChatMessage } from '@/lib/openai'
import type { Conversation } from '@/lib/types'

export type ConversationSummaryResult = { summary: string; intent: string }

const SYSTEM_PROMPT = `Você resume conversas entre um funcionário de IA e um contato (lead/cliente) de uma empresa, pra um operador humano decidir rápido se precisa agir.
Leia a transcrição abaixo e devolva APENAS um JSON, sem markdown, no formato:
{"summary": "resumo objetivo em até 3 frases, em português, do que já foi conversado e em que ponto ficou", "intent": "a intenção principal do contato, em poucas palavras (ex.: 'quer orçamento', 'reclamação sobre atraso', 'agendar visita')"}
Nunca invente informação que não está na transcrição. Se não der pra identificar uma intenção clara, responda intent com "não identificada".`

/** Formata as mensagens como transcrição legível pro modelo — não reaproveita ChatMessage[] porque isto é resumo de terceiros, não uma continuação de conversa (o modelo nunca deve "responder", só descrever). */
export function formatTranscript(messages: Pick<Conversation, 'direction' | 'content'>[]): string {
  return messages
    .map((m) => `[${m.direction === 'inbound' ? 'contato' : 'agente'}] ${m.content}`)
    .join('\n')
}

export async function summarizeConversation(params: {
  apiKey: string
  transcript: string
}): Promise<ConversationSummaryResult> {
  const history: ChatMessage[] = [{ role: 'user', content: params.transcript }]
  const result = await generateStructuredReply<Partial<ConversationSummaryResult>>({
    apiKey: params.apiKey,
    systemPrompt: SYSTEM_PROMPT,
    history,
    maxTokens: 300,
  })
  return { summary: result.summary ?? '', intent: result.intent ?? 'não identificada' }
}
