import { DIAGNOSIS_MAX_OUTPUT_TOKENS, QUOTE_MAX_BLOCKING_QUESTION_ROUNDS, quoteModelFor } from '../config'
import { diagnosisSchema, type Diagnosis } from '../contracts'
import { costUsd, worstCaseUsd } from '../budget'
import { NonRetryableError, type StageHandler } from '../runner'
import { conservativeImageTokens, conservativeTextTokens } from './image-tokens'
import type { DiagnosisModel } from './model'
import { loadPhotos, type LoadPhotosDeps } from './photos'
import { pendingFromDiagnosis, sanitizeDiagnosis } from './postprocess'
import { buildDiagnosisUserText, DIAGNOSIS_SYSTEM_PROMPT } from './prompt'
import type { PhotoPolicy } from '../jobs'
import type { AgentSnapshot } from '../agent/context'

export type DiagnosisHandlerDeps = {
  model: DiagnosisModel
  photoDeps: LoadPhotosDeps
  /** Padrão: modelo da etapa em config (`quoteModelFor('diagnosis')`). */
  modelName?: string
  /** Modelo mais capaz usado só quando o 1º resultado vem com confiança baixa/insuficiente E o orçamento permite (etapa opcional). */
  escalationModelName?: string
}

type Snapshot = AgentSnapshot & { photo_policy?: PhotoPolicy }

/**
 * Etapa 1 — diagnóstico visual (modelo econômico primeiro; escalona só com baixa confiança e orçamento).
 * Fluxo: carrega e reduz as fotos → calcula o PIOR CASO de custo → reserva orçamento → chama o modelo → valida o JSON
 * com Zod → aplica as travas determinísticas → devolve diagnóstico + pendências. Falhas de foto/IA nunca derrubam o salvamento.
 */
export function createDiagnosisHandler(deps: DiagnosisHandlerDeps): StageHandler {
  return {
    needsAi: true,
    async run(ctx) {
      const snapshot = ctx.job.input_snapshot as Snapshot
      const notes = snapshot.notes ?? ''
      const policy = snapshot.photo_policy ?? { photoCount: 0, visualAnalysis: false, belowStandard: true, missing: 5, exceptionAccepted: false, notes_pt: [] }
      const model = deps.modelName ?? quoteModelFor('diagnosis')

      const { images, unreadable, skippedOverLimit } = await loadPhotos(snapshot.media_urls ?? [], deps.photoDeps)
      const blockingAllowed = !snapshot.no_more_questions && ctx.job.rounds <= QUOTE_MAX_BLOCKING_QUESTION_ROUNDS
      const userText = buildDiagnosisUserText({ notes, photoCount: images.length, unreadableCount: unreadable.length, policy, conversation: snapshot.conversation, blockingAllowed })

      const inputTokens = conservativeTextTokens(DIAGNOSIS_SYSTEM_PROMPT) + conservativeTextTokens(userText) + images.reduce((n, i) => n + conservativeImageTokens(i), 0)
      type Attempt = { ok: true; data: Diagnosis; model: string; cost: number } | { ok: false; skipped: 'budget' | 'soft_limit' }
      const attempt = async (modelName: string, label: string, optional: boolean): Promise<Attempt> => {
        const worst = worstCaseUsd({ model: modelName, inputTokens, maxOutputTokens: DIAGNOSIS_MAX_OUTPUT_TOKENS })
        const guarded = await ctx.budget.run({
          label,
          worstCaseUsd: worst,
          optional,
          call: async () => {
            const response = await deps.model.analyze({ model: modelName, system: DIAGNOSIS_SYSTEM_PROMPT, userText, images: images.map((i) => ({ dataUrl: i.dataUrl })), maxOutputTokens: DIAGNOSIS_MAX_OUTPUT_TOKENS })
            return { result: response, actualUsd: costUsd({ model: modelName, inputTokens: response.inputTokens, outputTokens: response.outputTokens }), tokensIn: response.inputTokens, tokensOut: response.outputTokens }
          },
        })
        if (!guarded.ok) {
          if (guarded.skipped === 'unknown_model') throw new NonRetryableError(`Modelo "${modelName}" sem preço cadastrado: não executado.`, 'unknown_model')
          if (guarded.skipped === 'error') throw guarded.error ?? new Error('Falha na chamada de diagnóstico.')
          return { ok: false, skipped: guarded.skipped }
        }
        const response = guarded.result
        if (response.refusal) throw new NonRetryableError('A IA recusou analisar o conteúdo enviado.', 'model_refusal')
        const parsed = diagnosisSchema.safeParse(response.output)
        if (!parsed.success) throw new Error(`Diagnóstico fora do contrato: ${parsed.error.issues[0]?.message ?? 'inválido'}`)
        // número de fotos que o modelo diz ter analisado precisa bater com as enviadas
        if (parsed.data.photos_analyzed !== images.length) throw new Error(`Diagnóstico inconsistente: photos_analyzed=${parsed.data.photos_analyzed}, enviadas=${images.length}.`)
        return { ok: true, data: parsed.data, model: response.model, cost: guarded.actualUsd }
      }

      const first = await attempt(model, 'diagnosis', false)
      if (!first.ok) {
        return {
          kind: 'budget_exhausted',
          result: { skipped: first.skipped },
          pending: [{ code: 'diagnosis_skipped_budget', message_pt: 'Diagnóstico por IA não executado: orçamento de IA da cotação esgotado. Faça o diagnóstico manualmente.' }],
        }
      }
      let chosen = first
      let totalCost = first.cost
      let escalated = false
      // Escalonamento: modelo econômico primeiro; o mais capaz só se a confiança veio baixa, há fotos e sobra orçamento (etapa opcional, para em 80% do teto).
      if (deps.escalationModelName && deps.escalationModelName !== model && images.length > 0 && (first.data.visual_confidence === 'low' || first.data.visual_confidence === 'none')) {
        const second = await attempt(deps.escalationModelName, 'diagnosis_escalation', true).catch(() => ({ ok: false as const, skipped: 'budget' as const }))
        if (second.ok) {
          chosen = second
          totalCost += second.cost
          escalated = true
        }
      }

      const { diagnosis, warnings } = sanitizeDiagnosis(chosen.data, { unreadable })
      const pending = pendingFromDiagnosis(diagnosis)
      for (const note of policy.notes_pt) pending.push({ code: 'photo_policy', message_pt: note })
      if (skippedOverLimit > 0) warnings.push(`${skippedOverLimit} foto(s) além do limite de análise não foram enviadas à IA.`)

      const result = {
        diagnosis,
        warnings,
        photo_sources: images.map((i) => i.sourceUrl),
        unreadable_photos: unreadable.map((u) => u.url),
        model: chosen.model,
        escalated,
        cost_usd: totalCost,
      }

      // Com fotos mas sem condição de diagnosticar: para e pede ao técnico (resultado preservado).
      if (blockingAllowed && images.length > 0 && diagnosis.insufficient_photos && (diagnosis.visual_confidence === 'low' || diagnosis.visual_confidence === 'none')) {
        return { kind: 'needs_input', result, pending }
      }
      return { kind: 'done', result, pending }
    },
  }
}
