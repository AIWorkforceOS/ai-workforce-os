import { markNotCharged } from '../budget'
import { NonRetryableError } from '../runner'
import { getOpenAIApiKey } from '@/lib/openai'
import { DIAGNOSIS_JSON_SCHEMA } from './schema'

export type DiagnosisModelInput = {
  model: string
  system: string
  userText: string
  images: { dataUrl: string }[]
  maxOutputTokens: number
}

export type DiagnosisModelResult = {
  /** objeto já interpretado a partir do JSON devolvido (ainda NÃO validado — quem chama valida com Zod) */
  output: unknown
  inputTokens: number
  outputTokens: number
  refusal: string | null
  model: string
}

export interface DiagnosisModel {
  analyze(input: DiagnosisModelInput): Promise<DiagnosisModelResult>
}

/** Corpo do POST /v1/responses (formato da documentação oficial de 17/10/2026: input_text, input_image com image_url + detail, text.format json_schema strict). */
export function buildResponsesRequest(input: DiagnosisModelInput) {
  return {
    model: input.model,
    input: [
      { role: 'system', content: input.system },
      {
        role: 'user',
        content: [
          { type: 'input_text', text: input.userText },
          ...input.images.map((image) => ({ type: 'input_image', image_url: image.dataUrl, detail: 'high' })),
        ],
      },
    ],
    text: { format: { type: 'json_schema', name: 'quote_diagnosis', strict: true, schema: DIAGNOSIS_JSON_SCHEMA } },
    max_output_tokens: input.maxOutputTokens,
    store: false,
  }
}

type ResponsesJson = {
  status?: string
  incomplete_details?: { reason?: string } | null
  output?: { type?: string; content?: { type?: string; text?: string; refusal?: string }[] }[]
  usage?: { input_tokens?: number; output_tokens?: number }
  model?: string
  error?: { message?: string } | null
}

/** Lê a resposta: texto JSON, recusa e uso. Resposta cortada por limite de saída é erro (nunca se usa saída pela metade). */
export function parseResponsesResult(json: ResponsesJson, requestedModel: string): DiagnosisModelResult {
  if (json.error?.message) throw new Error(`OpenAI: ${json.error.message}`)
  if (json.status === 'incomplete') throw new Error(`Resposta incompleta (${json.incomplete_details?.reason ?? 'motivo desconhecido'}).`)
  const parts = (json.output ?? []).flatMap((item) => item.content ?? [])
  const refusal = parts.find((p) => p.type === 'refusal')?.refusal ?? null
  const text = parts.find((p) => p.type === 'output_text')?.text ?? null
  let output: unknown = null
  if (text) {
    try {
      output = JSON.parse(text)
    } catch {
      throw new Error('A IA devolveu um JSON inválido.')
    }
  }
  return { output, refusal, inputTokens: json.usage?.input_tokens ?? 0, outputTokens: json.usage?.output_tokens ?? 0, model: json.model ?? requestedModel }
}

/**
 * Implementação real (Responses API). NÃO é executada nos testes automáticos — chamadas pagas só com autorização do Vinicius.
 * Pontos a confirmar no PRIMEIRO teste real autorizado: formato exato da resposta, suporte a Structured Outputs neste modelo
 * e contagem de tokens de imagem.
 */
export class OpenAIResponsesDiagnosisModel implements DiagnosisModel {
  constructor(private readonly fetchImpl: typeof fetch = fetch, private readonly timeoutMs = 80_000) {}

  async analyze(input: DiagnosisModelInput): Promise<DiagnosisModelResult> {
    const apiKey = getOpenAIApiKey()
    if (!apiKey) throw markNotCharged(new NonRetryableError('OPENAI_API_KEY não configurada.', 'no_api_key'))
    const response = await this.fetchImpl('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(buildResponsesRequest(input)),
      signal: AbortSignal.timeout(this.timeoutMs),
    })
    const json = (await response.json().catch(() => ({}))) as ResponsesJson
    if (!response.ok) {
      // 4xx (exceto 408/429) não adianta repetir; o resto o runner repete com espera
      if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) {
        throw markNotCharged(new NonRetryableError(`OpenAI recusou a requisição (${response.status}): ${json.error?.message ?? 'sem detalhe'}`, 'openai_4xx'))
      }
      // 429 = limite de taxa, recusado antes de processar (sem cobrança); 408/5xx = ambíguo (pode ter processado)
      const err = new Error(`OpenAI retornou ${response.status}`)
      throw response.status === 429 ? markNotCharged(err) : err
    }
    return parseResponsesResult(json, input.model)
  }
}

/** Modelo falso para testes: devolve respostas roteirizadas, sem rede e sem custo. */
export class MockDiagnosisModel implements DiagnosisModel {
  calls: DiagnosisModelInput[] = []
  constructor(private readonly respond: (input: DiagnosisModelInput) => Partial<DiagnosisModelResult> & { output: unknown }) {}

  async analyze(input: DiagnosisModelInput): Promise<DiagnosisModelResult> {
    this.calls.push(input)
    const r = this.respond(input)
    return { refusal: null, inputTokens: 1500 + input.images.length * 1300, outputTokens: 800, model: input.model, ...r }
  }
}
