import { getOpenAIApiKey } from '@/lib/openai'
import { markNotCharged } from '../budget'
import { NonRetryableError } from '../runner'

/**
 * Cliente genérico de "resposta estruturada" (Responses API): texto (e imagens) → JSON que obedece a um esquema estrito.
 * Usado pelas etapas de materiais, preços e mão de obra. O diagnóstico visual tem o seu próprio cliente (já testado em produção real).
 * Chamadas pagas só acontecem aqui — e SEMPRE dentro de `BudgetGuard` (reserva antes, liquida com o custo real).
 */
export type StructuredInput = {
  model: string
  system: string
  userText: string
  images?: { dataUrl: string }[]
  schemaName: string
  jsonSchema: Record<string, unknown>
  maxOutputTokens: number
  /** Busca web (ferramenta `web_search` da OpenAI) restrita a estes domínios. US$ 10 por 1.000 chamadas + tokens do conteúdo recuperado. */
  webSearch?: { allowedDomains: readonly string[] }
}

export type StructuredResult = {
  output: unknown
  refusal: string | null
  inputTokens: number
  outputTokens: number
  webSearchCalls: number
  /** Fontes citadas pela busca (url_citation). Preço sem citação nunca é aceito pela camada de verificação. */
  citations: { url: string; title: string | null }[]
  model: string
}

export interface StructuredModel {
  run(input: StructuredInput): Promise<StructuredResult>
}

type ResponsesJson = {
  status?: string
  incomplete_details?: { reason?: string } | null
  output?: {
    type?: string
    content?: { type?: string; text?: string; refusal?: string; annotations?: { type?: string; url?: string; title?: string }[] }[]
  }[]
  usage?: { input_tokens?: number; output_tokens?: number }
  model?: string
  error?: { message?: string } | null
}

export function buildStructuredRequest(input: StructuredInput) {
  return {
    model: input.model,
    input: [
      { role: 'system', content: input.system },
      {
        role: 'user',
        content: [{ type: 'input_text', text: input.userText }, ...(input.images ?? []).map((i) => ({ type: 'input_image', image_url: i.dataUrl, detail: 'high' }))],
      },
    ],
    text: { format: { type: 'json_schema', name: input.schemaName, strict: true, schema: input.jsonSchema } },
    max_output_tokens: input.maxOutputTokens,
    store: false,
    ...(input.webSearch ? { tools: [{ type: 'web_search', filters: { allowed_domains: [...input.webSearch.allowedDomains] } }] } : {}),
  }
}

export function parseStructuredResult(json: ResponsesJson, requestedModel: string): StructuredResult {
  if (json.error?.message) throw new Error(`OpenAI: ${json.error.message}`)
  if (json.status === 'incomplete') throw new Error(`Resposta incompleta (${json.incomplete_details?.reason ?? 'motivo desconhecido'}).`)
  const items = json.output ?? []
  const webSearchCalls = items.filter((i) => i.type === 'web_search_call').length
  const parts = items.flatMap((i) => i.content ?? [])
  const refusal = parts.find((p) => p.type === 'refusal')?.refusal ?? null
  const textPart = parts.find((p) => p.type === 'output_text')
  let output: unknown = null
  if (textPart?.text) {
    try {
      output = JSON.parse(textPart.text)
    } catch {
      throw new Error('A IA devolveu um JSON inválido.')
    }
  }
  const seen = new Set<string>()
  const citations: { url: string; title: string | null }[] = []
  for (const part of parts) {
    for (const a of part.annotations ?? []) {
      if (a.type === 'url_citation' && a.url && !seen.has(a.url)) {
        seen.add(a.url)
        citations.push({ url: a.url, title: a.title ?? null })
      }
    }
  }
  return { output, refusal, inputTokens: json.usage?.input_tokens ?? 0, outputTokens: json.usage?.output_tokens ?? 0, webSearchCalls, citations, model: json.model ?? requestedModel }
}

/** Implementação real. Não roda nos testes automáticos (sem rede/custo); o 1º teste pago confirma suporte a esquema estrito + web_search no mesmo pedido. */
export class OpenAIStructuredModel implements StructuredModel {
  constructor(private readonly fetchImpl: typeof fetch = fetch, private readonly timeoutMs = 80_000) {}

  async run(input: StructuredInput): Promise<StructuredResult> {
    const apiKey = getOpenAIApiKey()
    if (!apiKey) throw markNotCharged(new NonRetryableError('OPENAI_API_KEY não configurada.', 'no_api_key'))
    const response = await this.fetchImpl('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(buildStructuredRequest(input)),
      signal: AbortSignal.timeout(this.timeoutMs),
    })
    const json = (await response.json().catch(() => ({}))) as ResponsesJson
    if (!response.ok) {
      if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) {
        throw markNotCharged(new NonRetryableError(`OpenAI recusou a requisição (${response.status}): ${json.error?.message ?? 'sem detalhe'}`, 'openai_4xx'))
      }
      const err = new Error(`OpenAI retornou ${response.status}`)
      throw response.status === 429 ? markNotCharged(err) : err
    }
    return parseStructuredResult(json, input.model)
  }
}

/** Modelo falso (testes): respostas roteirizadas, sem rede e sem custo. */
export class MockStructuredModel implements StructuredModel {
  calls: StructuredInput[] = []
  constructor(private readonly respond: (input: StructuredInput) => Partial<StructuredResult> & { output: unknown }) {}

  async run(input: StructuredInput): Promise<StructuredResult> {
    this.calls.push(input)
    const r = this.respond(input)
    return { refusal: null, inputTokens: 1200, outputTokens: 600, webSearchCalls: 0, citations: [], model: input.model, ...r }
  }
}
