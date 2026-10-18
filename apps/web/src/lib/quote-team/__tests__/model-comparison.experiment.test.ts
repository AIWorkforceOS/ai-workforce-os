import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { describe, it } from 'vitest'
import { costUsd } from '../budget'
import { DIAGNOSIS_MAX_OUTPUT_TOKENS } from '../config'
import { diagnosisSchema } from '../contracts'
import { conservativeImageTokens, conservativeTextTokens } from '../diagnosis/image-tokens'
import { OpenAIResponsesDiagnosisModel } from '../diagnosis/model'
import { prepareImage } from '../diagnosis/photos'
import { buildDiagnosisUserText, DIAGNOSIS_SYSTEM_PROMPT } from '../diagnosis/prompt'
import { sanitizeDiagnosis } from '../diagnosis/postprocess'
import { decidePhotoPolicy } from '../jobs'

/**
 * EXPERIMENTO PAGO (comparativo de modelos) — PULADO POR PADRÃO.
 * Teto GLOBAL US$ 5 (autorizado pelo Vinicius), incluindo a Etapa 0 já gasta. Ledger em arquivo; para em US$ 4,50.
 * RUN_EXPERIMENT=1 EXP_DIR=<pasta com fotos> pnpm --filter web exec vitest run src/lib/quote-team/__tests__/model-comparison.experiment.test.ts
 */
const enabled = process.env.RUN_EXPERIMENT === '1' && Boolean(process.env.OPENAI_API_KEY) && Boolean(process.env.EXP_DIR)
const GLOBAL_CAP = 5
const STOP_AT = 4.5
const PRIOR_SPEND = Number(process.env.EXP_PRIOR_SPEND ?? 0.035) // Etapa 0 (2 chamadas) — arredondado para cima
const MODELS = ['gpt-6.1-sol', 'gpt-6-luna', 'gpt-4o-mini']
// gpt-4o-mini cobra ~33x tokens por imagem (base 2833 + 5667/tile) e tem contexto de 128k
const MINI_IMAGE_TOKENS = 26000
const MINI_CONTEXT = 128000

type Case = { id: string; set: string | null; photos: number[]; notes: string; expect: string }
const CASES: Case[] = [
  { id: 'C1-cadeira-pt-1foto', set: '159959-02', photos: [0], notes: 'Cadeira da piscina quebrada, precisa trocar.', expect: 'Foto mostra cadeiras azuis de piscina; não dá para ver quebra específica nem modelo. Deve pedir foto do dano/etiqueta.' },
  { id: 'C2-portao-4fotos', set: '159959-02', photos: [0, 1, 2, 3], notes: 'Pool gate latch broken, gate does not close. Need to replace the latch.', expect: 'Fotos mostram grade/cerca, cadeiras, prédio, piscina; NENHUMA mostra portão/trava. Não pode confirmar trava nem inventar modelo.' },
  { id: 'C3-portao-8fotos', set: '159959-02', photos: [0, 1, 2, 3, 4, 5, 6, 7], notes: 'Pool gate latch broken, gate does not close. Need to replace the latch.', expect: 'Mesmo caso do C2 com 8 fotos: mesmas conclusões; mais fotos não devem gerar certeza inventada.' },
  { id: 'C4-quarto-3fotos', set: '161120-01', photos: [5, 6, 7], notes: 'Replace damaged nightstand drawer pull and check bedroom ceiling fan wobble.', expect: 'Fotos: quarto, cama, criado-mudo de madeira com gaveta, ventilador de teto parcialmente visível. Não dá para ver dano no puxador nem balanço do ventilador.' },
  { id: 'C5-borda-piscina-5fotos', set: '161120-01', photos: [0, 1, 2, 3, 4], notes: 'Pool-side tile coping loose/cracked near the step; needs re-grout.', expect: 'Fotos: borda da piscina com azulejo azul e degrau, noturnas, baixa luz. Não dá para confirmar azulejo solto/rachado; deve pedir foto de perto com luz.' },
  { id: 'C6-sem-foto', set: null, photos: [], notes: 'Water leaking under kitchen sink, P-trap suspected.', expect: 'Sem fotos: apenas organização do texto; visual_confidence none, nenhuma evidência visual.' },
  { id: 'C7-descasada', set: '161120-01', photos: [5, 6], notes: 'Pool pump motor is noisy and leaking water.', expect: 'Fotos são de quarto, não de bomba de piscina. Deve dizer que as fotos não mostram o equipamento; não inventar marca/modelo/peças.' },
]

describe.skipIf(!enabled)('EXPERIMENTO PAGO — comparativo de modelos de diagnóstico', () => {
  it('roda todos os casos em todos os modelos dentro do teto global', async () => {
    const dir = process.env.EXP_DIR as string
    const out = join(dir, 'results')
    const ledgerPath = join(dir, 'ledger.jsonl')
    const resultsPath = join(dir, 'results.json')
    const spent = (): number => (existsSync(ledgerPath) ? readFileSync(ledgerPath, 'utf8').split('\n').filter(Boolean).reduce((s, l) => s + JSON.parse(l).costUsd, 0) : 0) + PRIOR_SPEND
    void out
    const results: unknown[] = existsSync(resultsPath) ? JSON.parse(readFileSync(resultsPath, 'utf8')) : []
    const done = new Set((results as { caseId: string; model: string }[]).map((r) => `${r.caseId}|${r.model}`))
    const model = new OpenAIResponsesDiagnosisModel()

    for (const c of CASES) {
      const images = []
      for (const idx of c.photos) images.push(await prepareImage(await sharp(join(dir, `${c.set}-${idx}.jpg`)).toBuffer()))
      const userText = buildDiagnosisUserText({ notes: c.notes, photoCount: images.length, unreadableCount: 0, policy: decidePhotoPolicy({ photoCount: images.length }) })
      for (const m of MODELS) {
        if (done.has(`${c.id}|${m}`)) continue
        const isMini = m === 'gpt-4o-mini'
        const imgTokens = isMini ? images.length * MINI_IMAGE_TOKENS : images.reduce((s, i) => s + conservativeImageTokens(i), 0)
        const estIn = imgTokens + conservativeTextTokens(DIAGNOSIS_SYSTEM_PROMPT) + conservativeTextTokens(userText) + 2500 // +2500 do esquema strict
        const worst = costUsd({ model: m, inputTokens: estIn, outputTokens: DIAGNOSIS_MAX_OUTPUT_TOKENS })
        const base = { caseId: c.id, model: m, photos: images.length, expect: c.expect, notes: c.notes }
        let row: Record<string, unknown>
        if (isMini && estIn > MINI_CONTEXT * 0.9) {
          row = { ...base, skipped: `estimativa ${estIn} tokens excede o contexto de 128k do modelo` }
        } else if (worst > 0.6 || spent() + worst > STOP_AT) {
          row = { ...base, skipped: `trava de orçamento (pior caso US$ ${worst.toFixed(4)}; gasto acumulado US$ ${spent().toFixed(4)})` }
        } else {
          const t0 = Date.now()
          try {
            const r = await model.analyze({ model: m, system: DIAGNOSIS_SYSTEM_PROMPT, userText, images: images.map((i) => ({ dataUrl: i.dataUrl })), maxOutputTokens: DIAGNOSIS_MAX_OUTPUT_TOKENS })
            const ms = Date.now() - t0
            const cost = costUsd({ model: m, inputTokens: r.inputTokens, outputTokens: r.outputTokens })
            appendFileSync(ledgerPath, JSON.stringify({ caseId: c.id, model: m, costUsd: cost }) + '\n')
            const parsed = diagnosisSchema.safeParse(r.output)
            let metrics: Record<string, unknown> = {}
            if (parsed.success) {
              const raw = parsed.data
              const post = sanitizeDiagnosis(raw, { unreadable: [] })
              metrics = {
                evidence: raw.evidence.length,
                confirmationRequests: raw.additional_info_needed.length,
                inventedPartNumbersRemoved: post.warnings.filter((w) => w.startsWith('Part number')).length,
                brandOrModelNamed: Boolean(raw.identified.brand || raw.identified.model),
                labelsRead: raw.identified.labels_read.length,
                highConfidenceHypotheses: raw.hypotheses.filter((h) => h.confidence === 'high').length,
                visualConfidence: raw.visual_confidence,
                insufficientPhotos: raw.insufficient_photos,
                photosAnalyzed: raw.photos_analyzed,
                photosAnalyzedMatches: raw.photos_analyzed === images.length,
              }
            }
            row = { ...base, ms, inputTokens: r.inputTokens, outputTokens: r.outputTokens, estimatedInputWorstCase: estIn, costUsd: cost, refusal: r.refusal, schemaValid: parsed.success, schemaIssues: parsed.success ? [] : parsed.error.issues.map((i) => i.message).slice(0, 5), metrics, output: r.output }
          } catch (e) {
            // chamada com falha pode ter sido cobrada: contabiliza o PIOR CASO no ledger (nunca subestima)
            appendFileSync(ledgerPath, JSON.stringify({ caseId: c.id, model: m, costUsd: worst, failed: true }) + '\n')
            row = { ...base, ms: Date.now() - t0, error: String((e as Error).message).slice(0, 300), chargedWorstCase: worst }
          }
        }
        results.push(row)
        writeFileSync(resultsPath, JSON.stringify(results, null, 2))
      }
    }
    writeFileSync(join(dir, 'total-spent.txt'), spent().toFixed(4))
    if (spent() > GLOBAL_CAP) throw new Error('TETO GLOBAL ULTRAPASSADO')
  }, 1_800_000)
})
