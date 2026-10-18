import { DIAGNOSIS_MAX_OUTPUT_TOKENS, quoteModelFor } from '../config'
import { diagnosisSchema } from '../contracts'
import { costUsd, worstCaseUsd } from '../budget'
import { NonRetryableError, type StageHandler } from '../runner'
import { conservativeImageTokens, conservativeTextTokens } from './image-tokens'
import type { DiagnosisModel } from './model'
import { loadPhotos, type LoadPhotosDeps } from './photos'
import { pendingFromDiagnosis, sanitizeDiagnosis } from './postprocess'
import { buildDiagnosisUserText, DIAGNOSIS_SYSTEM_PROMPT } from './prompt'
import type { PhotoPolicy } from '../jobs'

export type DiagnosisHandlerDeps = {
  model: DiagnosisModel
  photoDeps: LoadPhotosDeps
  /** Padrão: modelo da etapa em config (`quoteModelFor('diagnosis')`). */
  modelName?: string
}

type Snapshot = { notes?: string; media_urls?: string[]; photo_policy?: PhotoPolicy }

/**
 * Etapa 1 — diagnóstico visual. NÃO está registrada em handlers.ts (o pipeline só liga quando as 6 etapas existirem).
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
      const userText = buildDiagnosisUserText({ notes, photoCount: images.length, unreadableCount: unreadable.length, policy })

      const inputTokens = conservativeTextTokens(DIAGNOSIS_SYSTEM_PROMPT) + conservativeTextTokens(userText) + images.reduce((n, i) => n + conservativeImageTokens(i), 0)
      const worst = worstCaseUsd({ model, inputTokens, maxOutputTokens: DIAGNOSIS_MAX_OUTPUT_TOKENS })

      const guarded = await ctx.budget.run({
        label: 'diagnosis',
        worstCaseUsd: worst,
        call: async () => {
          const response = await deps.model.analyze({ model, system: DIAGNOSIS_SYSTEM_PROMPT, userText, images: images.map((i) => ({ dataUrl: i.dataUrl })), maxOutputTokens: DIAGNOSIS_MAX_OUTPUT_TOKENS })
          return { result: response, actualUsd: costUsd({ model, inputTokens: response.inputTokens, outputTokens: response.outputTokens }), tokensIn: response.inputTokens, tokensOut: response.outputTokens }
        },
      })

      if (!guarded.ok) {
        if (guarded.skipped === 'unknown_model') throw new NonRetryableError(`Modelo "${model}" sem preço cadastrado: não executado.`, 'unknown_model')
        if (guarded.skipped === 'error') throw guarded.error ?? new Error('Falha na chamada de diagnóstico.')
        return {
          kind: 'budget_exhausted',
          result: { skipped: guarded.skipped },
          pending: [{ code: 'diagnosis_skipped_budget', message_pt: 'Diagnóstico por IA não executado: orçamento de IA da cotação esgotado. Faça o diagnóstico manualmente.' }],
        }
      }

      const response = guarded.result
      if (response.refusal) throw new NonRetryableError('A IA recusou analisar o conteúdo enviado.', 'model_refusal')

      const parsed = diagnosisSchema.safeParse(response.output)
      if (!parsed.success) throw new Error(`Diagnóstico fora do contrato: ${parsed.error.issues[0]?.message ?? 'inválido'}`)
      // número de fotos que o modelo diz ter analisado precisa bater com as enviadas
      if (parsed.data.photos_analyzed !== images.length) throw new Error(`Diagnóstico inconsistente: photos_analyzed=${parsed.data.photos_analyzed}, enviadas=${images.length}.`)

      const { diagnosis, warnings } = sanitizeDiagnosis(parsed.data, { unreadable })
      const pending = pendingFromDiagnosis(diagnosis)
      for (const note of policy.notes_pt) pending.push({ code: 'photo_policy', message_pt: note })
      if (skippedOverLimit > 0) warnings.push(`${skippedOverLimit} foto(s) além do limite de análise não foram enviadas à IA.`)

      const result = {
        diagnosis,
        warnings,
        photo_sources: images.map((i) => i.sourceUrl),
        unreadable_photos: unreadable.map((u) => u.url),
        model: response.model,
        cost_usd: guarded.actualUsd,
      }

      // Com fotos mas sem condição de diagnosticar: para e pede ao técnico (resultado preservado).
      if (images.length > 0 && diagnosis.insufficient_photos && (diagnosis.visual_confidence === 'low' || diagnosis.visual_confidence === 'none')) {
        return { kind: 'needs_input', result, pending }
      }
      return { kind: 'done', result, pending }
    },
  }
}
