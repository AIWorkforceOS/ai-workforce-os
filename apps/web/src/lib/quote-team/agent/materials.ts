import { MATERIALS_MAX_OUTPUT_TOKENS, QUOTE_MAX_BLOCKING_QUESTION_ROUNDS, quoteModelFor } from '../config'
import { materialItemSchema, type MaterialItem } from '../contracts'
import type { PendingItem } from '../contracts'
import type { StageHandler } from '../runner'
import { diagnosisFromSteps, groundingCorpus, isGrounded, type AgentSnapshot } from './context'
import { MATERIALS_SYSTEM_PROMPT, buildMaterialsUserText } from './prompts'
import { runStructuredStage } from './run-structured'
import { MATERIALS_JSON_SCHEMA, materialsLlmSchema } from './schemas'
import type { StructuredModel } from './structured-model'

export type MaterialsStageResult = { items: MaterialItem[]; warnings: string[]; questions: { kind: string; request_pt: string; blocking: boolean }[]; model: string; cost_usd: number }

/** Etapa 2 — identificação de materiais (sem preços). Marca/modelo/part number só ficam se aparecem nas evidências. */
export function createMaterialsHandler(deps: { model: StructuredModel; modelName?: string }): StageHandler {
  return {
    needsAi: true,
    async run(ctx) {
      const snapshot = ctx.job.input_snapshot as AgentSnapshot
      const diagnosis = diagnosisFromSteps(ctx.stepResults)
      const blockingAllowed = !snapshot.no_more_questions && ctx.job.rounds <= QUOTE_MAX_BLOCKING_QUESTION_ROUNDS
      const model = deps.modelName ?? quoteModelFor('materials')

      const run = await runStructuredStage({
        ctx,
        label: 'materials',
        model: deps.model,
        input: { model, system: MATERIALS_SYSTEM_PROMPT, userText: buildMaterialsUserText({ snapshot, diagnosis, blockingAllowed }), schemaName: 'quote_materials', jsonSchema: MATERIALS_JSON_SCHEMA, maxOutputTokens: MATERIALS_MAX_OUTPUT_TOKENS },
        schema: materialsLlmSchema,
      })
      if (!run.ok) {
        return { kind: 'budget_exhausted', result: { skipped: run.skipped }, pending: [{ code: 'materials_skipped_budget', message_pt: 'Lista de materiais por IA não gerada: orçamento de IA da cotação esgotado. Preencha os materiais manualmente.' }] }
      }

      const corpus = groundingCorpus(snapshot, diagnosis)
      const warnings: string[] = []
      const items: MaterialItem[] = []
      for (const raw of run.data.items) {
        const brand = isGrounded(raw.brand, corpus) ? raw.brand : null
        const modelName = isGrounded(raw.model, corpus) ? raw.model : null
        const partNumber = isGrounded(raw.part_number, corpus) ? raw.part_number : null
        if (raw.brand && !brand) warnings.push(`Marca "${raw.brand}" removida de "${raw.name_en}": não aparece nas evidências.`)
        if (raw.model && !modelName) warnings.push(`Modelo "${raw.model}" removido de "${raw.name_en}": não aparece nas evidências.`)
        if (raw.part_number && !partNumber) warnings.push(`Part number "${raw.part_number}" removido de "${raw.name_en}": não aparece nas evidências.`)
        // compatibilidade só se há identificação confirmada; senão vira pendência de verificação
        const compatibility = raw.compatibility && (brand || modelName || partNumber) ? raw.compatibility : null
        const needsConfirmation = raw.needs_confirmation ?? (raw.compatibility && !compatibility ? `Compatibilidade a verificar: ${raw.compatibility}` : null)
        const candidate = {
          kind: raw.kind, necessity: raw.necessity, name_en: raw.name_en.trim(), description_pt: raw.description_pt.trim(), quantity: raw.quantity, unit: raw.unit.trim(),
          brand, model: modelName, part_number: partNumber, dimensions: raw.dimensions, specs: null, compatibility, reason: raw.reason, confidence: raw.confidence,
          needs_confirmation: needsConfirmation, waste_pct: raw.waste_pct, waste_justification: raw.waste_justification,
        }
        const parsed = materialItemSchema.safeParse(candidate)
        if (!parsed.success) {
          warnings.push(`Item "${raw.name_en}" descartado: ${parsed.error.issues[0]?.message ?? 'inválido'}.`)
          continue
        }
        items.push(parsed.data)
      }

      const pending: PendingItem[] = []
      items.forEach((item, index) => {
        if (item.needs_confirmation) pending.push({ code: 'item_confirm', message_pt: `${item.name_en}: ${item.needs_confirmation}`, item_ref: String(index) })
      })
      const blocking = blockingAllowed ? run.data.questions.filter((q) => q.blocking) : []
      const result: MaterialsStageResult = { items, warnings, questions: run.data.questions, model: run.raw.model, cost_usd: run.costUsd }

      if (blocking.length > 0) {
        for (const q of blocking) pending.push({ code: `need_${q.kind}`, message_pt: q.request_pt })
        return { kind: 'needs_input', result, pending }
      }
      for (const q of run.data.questions) pending.push({ code: `info_${q.kind}`, message_pt: q.request_pt })
      return { kind: 'done', result, pending }
    },
  }
}
