import type { z } from 'zod'
import { costUsd, worstCaseUsd } from '../budget'
import { conservativeTextTokens } from '../diagnosis/image-tokens'
import { NonRetryableError, type StageContext } from '../runner'
import type { StructuredInput, StructuredModel, StructuredResult } from './structured-model'

export type StructuredRun<T> = { ok: true; data: T; costUsd: number; raw: StructuredResult } | { ok: false; skipped: 'budget' | 'soft_limit' }

/**
 * Uma chamada de modelo dentro do orçamento: estima o PIOR CASO, reserva (BudgetGuard), chama, valida o JSON com Zod e liquida
 * com o custo REAL. Recusa do modelo ou contrato inválido são erros (o runner repete com espera ou desiste mantendo o parcial).
 */
export async function runStructuredStage<S extends z.ZodType>(args: {
  ctx: StageContext
  label: string
  model: StructuredModel
  input: StructuredInput
  schema: S
  optional?: boolean
  /** Chamadas de busca no pior caso (cada uma custa à parte). */
  worstCaseSearches?: number
  /** Conteúdo recuperado pela busca no pior caso (tokens de entrada). */
  worstCaseRetrievedTokens?: number
}): Promise<StructuredRun<z.infer<S>>> {
  const { input } = args
  const schemaTokens = Math.ceil(JSON.stringify(input.jsonSchema).length / 3)
  const inputTokens = conservativeTextTokens(input.system) + conservativeTextTokens(input.userText) + schemaTokens + (args.worstCaseRetrievedTokens ?? 0)
  const worst = worstCaseUsd({ model: input.model, inputTokens, maxOutputTokens: input.maxOutputTokens, webSearchCalls: args.worstCaseSearches ?? 0 })

  const guarded = await args.ctx.budget.run({
    label: args.label,
    worstCaseUsd: worst,
    optional: args.optional,
    call: async () => {
      const raw = await args.model.run(input)
      return { result: raw, actualUsd: costUsd({ model: input.model, inputTokens: raw.inputTokens, outputTokens: raw.outputTokens, webSearchCalls: raw.webSearchCalls }), tokensIn: raw.inputTokens, tokensOut: raw.outputTokens }
    },
  })

  if (!guarded.ok) {
    if (guarded.skipped === 'unknown_model') throw new NonRetryableError(`Modelo "${input.model}" sem preço cadastrado: não executado.`, 'unknown_model')
    if (guarded.skipped === 'error') throw guarded.error ?? new Error(`Falha na chamada "${args.label}".`)
    return { ok: false, skipped: guarded.skipped }
  }
  const raw = guarded.result
  if (raw.refusal) throw new NonRetryableError('A IA recusou analisar o conteúdo enviado.', 'model_refusal')
  const parsed = args.schema.safeParse(raw.output)
  if (!parsed.success) throw new Error(`Resposta "${args.label}" fora do contrato: ${parsed.error.issues[0]?.message ?? 'inválida'}`)
  return { ok: true, data: parsed.data, costUsd: guarded.actualUsd, raw }
}
