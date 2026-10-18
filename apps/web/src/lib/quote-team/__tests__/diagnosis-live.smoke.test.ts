import { writeFileSync } from 'node:fs'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { costUsd } from '../budget'
import { DIAGNOSIS_MAX_OUTPUT_TOKENS, quoteModelFor } from '../config'
import { diagnosisSchema } from '../contracts'
import { conservativeImageTokens } from '../diagnosis/image-tokens'
import { OpenAIResponsesDiagnosisModel } from '../diagnosis/model'
import { prepareImage } from '../diagnosis/photos'
import { buildDiagnosisUserText, DIAGNOSIS_SYSTEM_PROMPT } from '../diagnosis/prompt'
import { decidePhotoPolicy } from '../jobs'

/**
 * TESTE PAGO — PULADO POR PADRÃO. Só roda com autorização expressa do Vinicius:
 *   RUN_PAID_SMOKE=1 OPENAI_API_KEY=… QUOTE_SMOKE_PHOTO=/caminho/foto.jpg pnpm --filter web exec vitest run src/lib/quote-team/__tests__/diagnosis-live.smoke.test.ts
 * Faz UMA chamada real (1 foto + nota curta) e confere: modelo disponível, visão, Structured Outputs com o NOSSO esquema,
 * formato da resposta, contagem de tokens de imagem vs. estimativa, latência e custo. Teto de segurança: QUOTE_SMOKE_MAX_USD (padrão 0,10).
 */
const enabled = process.env.RUN_PAID_SMOKE === '1' && Boolean(process.env.OPENAI_API_KEY)

describe.skipIf(!enabled)('SMOKE PAGO — diagnóstico visual na API real', () => {
  it('1 foto + nota: resposta válida no nosso contrato, custo dentro do teto', async () => {
    const model = quoteModelFor('diagnosis')
    const source = process.env.QUOTE_SMOKE_PHOTO
    const photo = source ? await sharp(source).toBuffer() : await sharp({ create: { width: 1200, height: 900, channels: 3, background: '#778899' } }).jpeg().toBuffer()
    const image = await prepareImage(photo)
    const notes = 'Porta comercial não fecha direito. Door closer aparentemente danificado.'
    const userText = buildDiagnosisUserText({ notes, photoCount: 1, unreadableCount: 0, policy: decidePhotoPolicy({ photoCount: 1 }) })

    const startedAt = Date.now()
    const result = await new OpenAIResponsesDiagnosisModel().analyze({ model, system: DIAGNOSIS_SYSTEM_PROMPT, userText, images: [{ dataUrl: image.dataUrl }], maxOutputTokens: DIAGNOSIS_MAX_OUTPUT_TOKENS })
    const ms = Date.now() - startedAt

    const cost = costUsd({ model, inputTokens: result.inputTokens, outputTokens: result.outputTokens })
    const estimatedInput = conservativeImageTokens(image) + Math.ceil((DIAGNOSIS_SYSTEM_PROMPT.length + userText.length) / 3)
    const report = { requestedModel: model, answeredModel: result.model, ms, inputTokens: result.inputTokens, outputTokens: result.outputTokens, estimatedInputWorstCase: estimatedInput, imageEstimatedTokens: conservativeImageTokens(image), costUsd: cost, refusal: result.refusal, notes, output: result.output }
    if (process.env.QUOTE_SMOKE_OUT) writeFileSync(process.env.QUOTE_SMOKE_OUT, JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report, null, 2))

    expect(result.refusal).toBeNull()
    expect(diagnosisSchema.safeParse(result.output).success).toBe(true)
    expect(cost).toBeLessThanOrEqual(Number(process.env.QUOTE_SMOKE_MAX_USD ?? 0.1))
    // a estimativa de pior caso NÃO pode ficar abaixo do real (senão o orçamento seria furado)
    expect(estimatedInput).toBeGreaterThanOrEqual(result.inputTokens)
  }, 120_000)
})
