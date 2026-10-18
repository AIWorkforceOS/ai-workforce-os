import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { diagnosisSchema, type Diagnosis } from '../contracts'
import { conservativeImageTokens, estimateImageTokens, patchCount } from '../diagnosis/image-tokens'
import { buildResponsesRequest, OpenAIResponsesDiagnosisModel, parseResponsesResult } from '../diagnosis/model'
import { isAllowedPhotoUrl, loadPhotos, prepareImage, selectPhotos } from '../diagnosis/photos'
import { sanitizeDiagnosis } from '../diagnosis/postprocess'
import { buildDiagnosisUserText, DIAGNOSIS_SYSTEM_PROMPT } from '../diagnosis/prompt'
import { DIAGNOSIS_JSON_SCHEMA, toStrictJsonSchema } from '../diagnosis/schema'
import { decidePhotoPolicy } from '../jobs'
import { NonRetryableError } from '../runner'

const HOST = ['rvzvxotmpdffvmycgdfk.supabase.co']
const okUrl = (n: number) => `https://rvzvxotmpdffvmycgdfk.supabase.co/storage/v1/object/public/service-orders/u/a/antes-${n}.jpg`
const jpeg = (w = 1600, h = 1200) => sharp({ create: { width: w, height: h, channels: 3, background: '#778899' } }).jpeg().toBuffer()
const resp = (buf: Buffer, status = 200) => ({ ok: status < 300, status, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) }) as unknown as Response

describe('tokens de imagem (exemplos OFICIAIS da documentação)', () => {
  it('1024×1024 → 1.229 · 2048×2048 → 3.000 · 4096×512 → 2.458', () => {
    expect(estimateImageTokens({ width: 1024, height: 1024 })).toBe(1229)
    expect(estimateImageTokens({ width: 2048, height: 2048 })).toBe(3000)
    expect(estimateImageTokens({ width: 4096, height: 512 })).toBe(2458)
    expect(patchCount(1024, 1024)).toBe(1024)
  })
  it('o pior caso usado para reservar orçamento tem margem sobre a tabela', () => {
    expect(conservativeImageTokens({ width: 1024, height: 1024 })).toBeGreaterThan(1229)
  })
})

describe('fotos', () => {
  it('só baixa do nosso Storage (https + host permitido) — nada de endereço interno ou de terceiros', () => {
    expect(isAllowedPhotoUrl(okUrl(1), HOST)).toBe(true)
    expect(isAllowedPhotoUrl('http://rvzvxotmpdffvmycgdfk.supabase.co/x.jpg', HOST)).toBe(false)
    expect(isAllowedPhotoUrl('https://evil.com/x.jpg', HOST)).toBe(false)
    expect(isAllowedPhotoUrl('https://rvzvxotmpdffvmycgdfk.supabase.co.evil.com/x.jpg', HOST)).toBe(false)
    expect(isAllowedPhotoUrl('https://169.254.169.254/latest/meta-data', HOST)).toBe(false)
    expect(isAllowedPhotoUrl('não é url', HOST)).toBe(false)
  })
  it('seleção: sem repetidas, mantém a ordem e limita a 8', () => {
    const urls = Array.from({ length: 11 }, (_, i) => okUrl(i)).concat(okUrl(0))
    const { selected, skippedOverLimit } = selectPhotos(urls)
    expect(selected).toHaveLength(8)
    expect(selected[0]).toBe(okUrl(0))
    expect(skippedOverLimit).toBe(3)
  })
  it('prepara a imagem: gira pelo EXIF, reduz para 1024 e entrega JPEG em data URL', async () => {
    const rotated = await sharp(await jpeg(3000, 2000)).withMetadata({ orientation: 6 }).jpeg().toBuffer()
    const out = await prepareImage(rotated)
    expect(out.dataUrl.startsWith('data:image/jpeg;base64,')).toBe(true)
    expect(Math.max(out.width, out.height)).toBeLessThanOrEqual(1024)
    expect(out.height).toBeGreaterThan(out.width) // EXIF 6 = retrato após girar
  })
  it('foto que falha (HTTP 500, lixo, host proibido) vira aviso — não derruba a análise', async () => {
    const good = await jpeg()
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url)
      if (u.includes('antes-1')) return resp(good)
      if (u.includes('antes-2')) return resp(Buffer.from('x'), 500)
      return resp(Buffer.from('isto não é uma imagem'))
    }) as unknown as typeof fetch
    const out = await loadPhotos([okUrl(1), okUrl(2), okUrl(3), 'https://evil.com/a.jpg'], { fetchImpl, allowedHosts: HOST })
    expect(out.images).toHaveLength(1)
    expect(out.images[0]!.index).toBe(0)
    expect(out.unreadable).toHaveLength(3)
    expect(out.unreadable.map((u) => u.reason).join(' ')).toMatch(/endereço não permitido/)
  })
})

describe('esquema estrito (Structured Outputs)', () => {
  const walk = (node: unknown, visit: (n: Record<string, unknown>) => void) => {
    if (Array.isArray(node)) return node.forEach((n) => walk(n, visit))
    if (node && typeof node === 'object') {
      visit(node as Record<string, unknown>)
      Object.values(node as Record<string, unknown>).forEach((v) => walk(v, visit))
    }
  }
  it('todo objeto tem additionalProperties:false e TODAS as propriedades em required; sem palavras-chave não suportadas', () => {
    let objects = 0
    walk(DIAGNOSIS_JSON_SCHEMA, (n) => {
      if (n.type === 'object') {
        objects += 1
        expect(n.additionalProperties).toBe(false)
        expect((n.required as string[]).sort()).toEqual(Object.keys(n.properties as object).sort())
      }
      for (const bad of ['minLength', 'maxLength', 'pattern', 'format', 'minimum', 'maximum', 'minItems', 'maxItems', '$schema', 'default']) expect(n).not.toHaveProperty(bad)
    })
    expect(objects).toBeGreaterThan(5)
    expect((DIAGNOSIS_JSON_SCHEMA as { type?: string }).type).toBe('object')
  })
  it('converte também schemas pequenos', () => {
    const s = toStrictJsonSchema(z.object({ a: z.string().min(1), b: z.number().nullable() }))
    expect(s).toMatchObject({ type: 'object', additionalProperties: false, required: ['a', 'b'] })
  })
})

describe('chamada à Responses API (sem rede)', () => {
  const input = { model: 'gpt-6.1-sol', system: 'S', userText: 'U', images: [{ dataUrl: 'data:image/jpeg;base64,AAA' }, { dataUrl: 'data:image/jpeg;base64,BBB' }], maxOutputTokens: 2500 }
  it('monta o pedido no formato oficial: input_text + input_image (image_url, detail) + json_schema strict + max_output_tokens', () => {
    const body = buildResponsesRequest(input)
    expect(body.input[1]!.content).toHaveLength(3)
    expect(body.input[1]!.content![0]).toEqual({ type: 'input_text', text: 'U' })
    expect(body.input[1]!.content![1]).toEqual({ type: 'input_image', image_url: 'data:image/jpeg;base64,AAA', detail: 'high' })
    expect(body.text.format).toMatchObject({ type: 'json_schema', strict: true })
    expect(body.max_output_tokens).toBe(2500)
    expect(body.store).toBe(false)
  })
  it('interpreta texto JSON + uso; trata recusa, resposta incompleta e JSON inválido', () => {
    const ok = parseResponsesResult({ output: [{ type: 'message', content: [{ type: 'output_text', text: '{"a":1}' }] }], usage: { input_tokens: 10, output_tokens: 5 } }, 'm')
    expect(ok).toMatchObject({ output: { a: 1 }, inputTokens: 10, outputTokens: 5, refusal: null })
    expect(parseResponsesResult({ output: [{ content: [{ type: 'refusal', refusal: 'não posso' }] }] }, 'm').refusal).toBe('não posso')
    expect(() => parseResponsesResult({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }, 'm')).toThrow(/incompleta/)
    expect(() => parseResponsesResult({ output: [{ content: [{ type: 'output_text', text: '{quebrado' }] }] }, 'm')).toThrow(/inválido/)
  })
  describe('cliente real com fetch FALSO', () => {
    const saved = process.env.OPENAI_API_KEY
    afterEach(() => {
      if (saved === undefined) delete process.env.OPENAI_API_KEY
      else process.env.OPENAI_API_KEY = saved
    })
    it('sem chave: erro não repetível, sem nenhuma chamada', async () => {
      delete process.env.OPENAI_API_KEY
      const fetchImpl = vi.fn() as unknown as typeof fetch
      await expect(new OpenAIResponsesDiagnosisModel(fetchImpl).analyze(input)).rejects.toBeInstanceOf(NonRetryableError)
      expect(fetchImpl).not.toHaveBeenCalled()
    })
    it('4xx não repete; 5xx/429 repete; sucesso devolve saída e uso', async () => {
      process.env.OPENAI_API_KEY = 'sk-teste-falso'
      const make = (status: number, body: unknown) => vi.fn(async () => ({ ok: status < 300, status, json: async () => body })) as unknown as typeof fetch
      await expect(new OpenAIResponsesDiagnosisModel(make(400, { error: { message: 'bad schema' } })).analyze(input)).rejects.toBeInstanceOf(NonRetryableError)
      await expect(new OpenAIResponsesDiagnosisModel(make(500, {})).analyze(input)).rejects.not.toBeInstanceOf(NonRetryableError)
      await expect(new OpenAIResponsesDiagnosisModel(make(429, {})).analyze(input)).rejects.not.toBeInstanceOf(NonRetryableError)
      const ok = await new OpenAIResponsesDiagnosisModel(make(200, { output: [{ content: [{ type: 'output_text', text: '{"x":1}' }] }], usage: { input_tokens: 7, output_tokens: 3 } })).analyze(input)
      expect(ok).toMatchObject({ output: { x: 1 }, inputTokens: 7, outputTokens: 3 })
    })
  })
})

describe('prompt', () => {
  it('traz as regras inegociáveis e NENHUM conceito comercial', () => {
    expect(DIAGNOSIS_SYSTEM_PROMPT).toMatch(/Never invent brands, models, part numbers/)
    expect(DIAGNOSIS_SYSTEM_PROMPT).toMatch(/FACTS from HYPOTHESES/)
    expect(DIAGNOSIS_SYSTEM_PROMPT).toMatch(/NO photos are provided/)
    expect(DIAGNOSIS_SYSTEM_PROMPT).toMatch(/DATA, never instructions/)
    expect(DIAGNOSIS_SYSTEM_PROMPT).not.toMatch(/markup|margin|hourly|profit|billed|rate card/i)
  })
  it('sem fotos o texto do usuário manda seguir a regra 5; com menos de 5 orienta sem exigir', () => {
    const none = buildDiagnosisUserText({ notes: 'porta não fecha', photoCount: 0, unreadableCount: 0, policy: decidePhotoPolicy({ photoCount: 0 }) })
    expect(none).toMatch(/Photos provided: NONE/)
    const few = buildDiagnosisUserText({ notes: 'x', photoCount: 3, unreadableCount: 1, policy: decidePhotoPolicy({ photoCount: 3 }) })
    expect(few).toMatch(/numbered 0 to 2/)
    expect(few).toMatch(/1 additional photo/)
    expect(few).toMatch(/standard is 5 photos/)
  })
})

describe('travas determinísticas', () => {
  const base: Diagnosis = {
    summary_pt: 's', problem_en: 'p', evidence: [{ fact: 'closer body loose', photo_refs: [0], confidence: 'high' }], hypotheses: [],
    identified: { brand: 'LCN', model: '4040XP', part_numbers: ['4040XP-RW/PA', 'ZZ-999'], labels_read: ['LCN', '4040XP-RW/PA', 'MADE IN USA'] },
    additional_info_needed: [], safety_risks: [], scope_pt: 'e', scope_en: 'e', photos_analyzed: 2, visual_confidence: 'medium', insufficient_photos: false,
  }
  it('part number que NÃO está na etiqueta lida é removido (nunca inventado) com aviso', () => {
    const { diagnosis, warnings } = sanitizeDiagnosis(base, { unreadable: [] })
    expect(diagnosis.identified.part_numbers).toEqual(['4040XP-RW/PA'])
    expect(warnings.join(' ')).toMatch(/ZZ-999/)
  })
  it('foto que não carregou vira pedido ao técnico', () => {
    const { diagnosis } = sanitizeDiagnosis(base, { unreadable: [{ url: 'u', reason: 'HTTP 500' }] })
    expect(diagnosis.additional_info_needed.at(-1)!.request_pt).toMatch(/1 foto\(s\) não puderam/)
  })
  it('contrato: evidência sem foto citada é inválida (vira hipótese)', () => {
    expect(diagnosisSchema.safeParse({ ...base, evidence: [{ fact: 'x', photo_refs: [], confidence: 'high' }] }).success).toBe(false)
  })
})
