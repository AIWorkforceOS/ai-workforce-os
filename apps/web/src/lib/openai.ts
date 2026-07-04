export function getOpenAIApiKey(): string | null {
  return process.env.OPENAI_API_KEY || null
}

export type ChatMessage = { role: 'user' | 'assistant'; content: string }

export async function generateChatReply(params: {
  apiKey: string
  systemPrompt: string
  history: ChatMessage[]
}): Promise<string> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'system', content: params.systemPrompt }, ...params.history],
      temperature: 0.7,
      max_tokens: 400,
    }),
  })

  const data = await response.json()

  if (!response.ok) {
    throw new Error(data?.error?.message ?? `OpenAI retornou status ${response.status}`)
  }

  return (data.choices?.[0]?.message?.content ?? '').trim()
}
