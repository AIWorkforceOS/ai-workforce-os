import { LABOR_MAX_OUTPUT_TOKENS, quoteModelFor } from '../config'
import { laborSchema, manHours, type LaborPlan, type PendingItem } from '../contracts'
import type { StageHandler } from '../runner'
import { diagnosisFromSteps, type AgentSnapshot } from './context'
import type { MaterialsStageResult } from './materials'
import { LABOR_SYSTEM_PROMPT, buildLaborUserText } from './prompts'
import { runStructuredStage } from './run-structured'
import { LABOR_JSON_SCHEMA, laborLlmSchema } from './schemas'
import type { StructuredModel } from './structured-model'

export type LaborStageResult = { labor: LaborPlan; man_hours: number; warnings: string[]; model: string; cost_usd: number }

/** Horas razoáveis para uma única ordem de serviço de manutenção: acima disso exige confirmação humana (não inventa). */
const MAX_PLAUSIBLE_SERVICE_HOURS = 24
const MAX_PLAUSIBLE_TECHNICIANS = 4

/** Etapa 4 — mão de obra (SEM dinheiro). Horas-homem = técnicos × horas, calculadas em CÓDIGO. */
export function createLaborHandler(deps: { model: StructuredModel; modelName?: string }): StageHandler {
  return {
    needsAi: true,
    async run(ctx) {
      const snapshot = ctx.job.input_snapshot as AgentSnapshot
      const diagnosis = diagnosisFromSteps(ctx.stepResults)
      const materials = (ctx.stepResults.materials as MaterialsStageResult | undefined)?.items ?? []
      const model = deps.modelName ?? quoteModelFor('labor')
      const run = await runStructuredStage({
        ctx,
        label: 'labor',
        model: deps.model,
        input: {
          model,
          system: LABOR_SYSTEM_PROMPT,
          userText: buildLaborUserText({ snapshot, diagnosis, items: materials.map((m) => ({ kind: m.kind, name_en: m.name_en, quantity: m.quantity, unit: m.unit, necessity: m.necessity })) }),
          schemaName: 'quote_labor',
          jsonSchema: LABOR_JSON_SCHEMA,
          maxOutputTokens: LABOR_MAX_OUTPUT_TOKENS,
        },
        schema: laborLlmSchema,
      })
      if (!run.ok) {
        return { kind: 'budget_exhausted', result: { skipped: run.skipped }, pending: [{ code: 'labor_skipped_budget', message_pt: 'Estimativa de mão de obra por IA não gerada: orçamento de IA da cotação esgotado. Informe técnicos e horas manualmente.' }] }
      }

      const warnings: string[] = []
      const pending: PendingItem[] = []
      let technicians = Math.max(1, Math.round(run.data.technicians))
      let justification = run.data.multi_technician_justification?.trim() || null
      if (technicians > 1 && !justification) {
        warnings.push(`A IA sugeriu ${technicians} técnicos sem justificativa concreta: ajustado para 1 técnico.`)
        technicians = 1
      }
      if (technicians > MAX_PLAUSIBLE_TECHNICIANS) {
        warnings.push(`Equipe sugerida (${technicians}) acima do plausível: limitada a ${MAX_PLAUSIBLE_TECHNICIANS}. Confirme.`)
        technicians = MAX_PLAUSIBLE_TECHNICIANS
      }
      if (technicians === 1) justification = null
      let serviceHours = Math.max(0, run.data.service_hours)
      if (serviceHours > MAX_PLAUSIBLE_SERVICE_HOURS) {
        warnings.push(`Horas sugeridas (${serviceHours} h) acima do plausível para uma ordem: confirme o escopo.`)
        pending.push({ code: 'labor_hours_check', message_pt: `Horas de serviço sugeridas (${serviceHours} h) parecem altas — confirme o escopo e ajuste.` })
        serviceHours = MAX_PLAUSIBLE_SERVICE_HOURS
      }
      const breakdownTotal = run.data.breakdown.reduce((n, b) => n + Math.max(0, b.hours), 0)
      if (run.data.breakdown.length > 0 && Math.abs(breakdownTotal - serviceHours) > Math.max(0.5, serviceHours * 0.25)) {
        warnings.push(`As etapas somam ${breakdownTotal.toFixed(2)} h, diferente das ${serviceHours} h de serviço: confirme.`)
      }

      const parsed = laborSchema.safeParse({
        technicians,
        service_hours: serviceHours,
        travel_hours: run.data.travel_hours,
        idle_hours: run.data.idle_hours,
        multi_technician_justification: justification,
        justification_pt: run.data.justification_pt.trim() || 'Estimativa baseada no escopo descrito.',
        description_en: run.data.description_en.trim() || 'On-site repair as described.',
        breakdown: run.data.breakdown.map((b) => ({ phase: b.phase, hours: Math.max(0, b.hours) })),
      })
      if (!parsed.success) throw new Error(`Mão de obra fora do contrato: ${parsed.error.issues[0]?.message ?? 'inválida'}`)

      const result: LaborStageResult = { labor: parsed.data, man_hours: manHours(parsed.data.technicians, parsed.data.service_hours), warnings, model: run.raw.model, cost_usd: run.costUsd }
      return { kind: 'done', result, pending }
    },
  }
}
