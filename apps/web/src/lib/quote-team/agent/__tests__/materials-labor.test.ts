import { describe, expect, it } from 'vitest'
import { createLaborHandler } from '../labor'
import { createMaterialsHandler } from '../materials'
import { MockStructuredModel } from '../structured-model'
import { diagnosisFixture, laborFixture, materialsFixture, stageContext } from './helpers'

const diag = (over = {}) => ({ diagnosis: diagnosisFixture(over) })

describe('materiais', () => {
  it('lista itens e NÃO deixa marca/modelo/part number que não aparecem nas evidências', async () => {
    const model = new MockStructuredModel(() => ({ output: materialsFixture([{ name_en: 'Door closer', brand: 'LCN', model: '4040XP', part_number: 'XYZ-123', compatibility: 'Fits all doors' }]) }))
    const { ctx } = await stageContext({ stepResults: { diagnosis: diag() } })
    const out = await createMaterialsHandler({ model }).run(ctx)
    const item = (out as { result: { items: Record<string, unknown>[]; warnings: string[] } }).result.items[0]!
    expect(item.brand).toBeNull()
    expect(item.model).toBeNull()
    expect(item.part_number).toBeNull()
    expect(item.compatibility).toBeNull()
    expect(String(item.needs_confirmation)).toMatch(/compatibilidade a verificar/i)
    expect((out as { result: { warnings: string[] } }).result.warnings.length).toBe(3)
  })
  it('mantém marca/modelo/part number quando LIDOS na etiqueta (ou escritos pelo técnico)', async () => {
    const model = new MockStructuredModel(() => ({ output: materialsFixture([{ brand: 'LCN', model: '4040XP', part_number: '4040-XP-ABC', compatibility: 'Matches the label on the unit' }]) }))
    const d = diag({ identified: { brand: 'LCN', model: '4040XP', part_numbers: ['4040-XP-ABC'], labels_read: ['LCN 4040XP P/N 4040-XP-ABC'] } })
    const { ctx } = await stageContext({ stepResults: { diagnosis: d } })
    const item = ((await createMaterialsHandler({ model }).run(ctx)) as { result: { items: Record<string, unknown>[] } }).result.items[0]!
    expect(item).toMatchObject({ brand: 'LCN', model: '4040XP', part_number: '4040-XP-ABC' })
    expect(item.compatibility).toBe('Matches the label on the unit')
  })
  it('pergunta bloqueante ⇒ needs_input com pedidos agrupados (need_*)', async () => {
    const model = new MockStructuredModel(() => ({ output: materialsFixture([{ confidence: 'low', needs_confirmation: 'Modelo da mola' }], [{ kind: 'label', request_pt: 'Foto da etiqueta da mola' }, { kind: 'dimensions', request_pt: 'Largura da porta' }]) }))
    const { ctx } = await stageContext({ stepResults: { diagnosis: diag() } })
    const out = await createMaterialsHandler({ model }).run(ctx)
    expect(out.kind).toBe('needs_input')
    expect((out as { pending: { code: string }[] }).pending.filter((p) => p.code.startsWith('need_')).map((p) => p.code)).toEqual(['need_label', 'need_dimensions'])
  })
  it('depois de "continuar sem essas informações" (ou rodadas esgotadas) NUNCA bloqueia', async () => {
    const model = new MockStructuredModel(() => ({ output: materialsFixture([{}], [{ kind: 'label', request_pt: 'Foto da etiqueta' }]) }))
    const a = await stageContext({ stepResults: { diagnosis: diag() }, snapshot: { notes: 'x', media_urls: [], conversation: [], no_more_questions: true } })
    expect((await createMaterialsHandler({ model }).run(a.ctx)).kind).toBe('done')
    const b = await stageContext({ stepResults: { diagnosis: diag() }, rounds: 3 })
    expect((await createMaterialsHandler({ model }).run(b.ctx)).kind).toBe('done')
    // e o prompt avisa o modelo
    expect(model.calls[0]!.userText).toMatch(/NOT allowed anymore/)
  })
  it('a conversa do técnico vai ao modelo e item inválido é descartado com aviso', async () => {
    const model = new MockStructuredModel(() => ({ output: materialsFixture([{ quantity: 0, name_en: 'Bad' }, { name_en: 'Good' }]) }))
    const snapshot = { notes: 'porta', media_urls: [], conversation: [{ role: 'technician' as const, kind: 'revision_request' as const, body: 'Considere reparar em vez de substituir', at: '', media_count: 0 }] }
    const { ctx } = await stageContext({ stepResults: { diagnosis: diag() }, snapshot })
    const out = await createMaterialsHandler({ model }).run(ctx)
    expect(model.calls[0]!.userText).toContain('Considere reparar em vez de substituir')
    expect((out as { result: { items: { name_en: string }[]; warnings: string[] } }).result.items.map((i) => i.name_en)).toEqual(['Good'])
  })
  it('sem orçamento: devolve budget_exhausted com orientação manual e não chama o modelo', async () => {
    const model = new MockStructuredModel(() => ({ output: materialsFixture([{}]) }))
    const { ctx } = await stageContext({ stepResults: { diagnosis: diag() }, budget: 0.0000001 })
    const out = await createMaterialsHandler({ model }).run(ctx)
    expect(out.kind).toBe('budget_exhausted')
    expect(model.calls).toHaveLength(0)
  })
})

describe('mão de obra', () => {
  it('horas-homem calculadas em CÓDIGO (2 técnicos × 2 h = 4 h-homem)', async () => {
    const model = new MockStructuredModel(() => ({ output: laborFixture({ technicians: 2, service_hours: 2, multi_technician_justification: 'Porta de vidro pesada: manuseio seguro exige duas pessoas' }) }))
    const { ctx } = await stageContext({ stepResults: { diagnosis: diag(), materials: { items: [] } } })
    const out = await createLaborHandler({ model }).run(ctx)
    expect((out as { result: { man_hours: number; labor: { technicians: number } } }).result).toMatchObject({ man_hours: 4, labor: { technicians: 2 } })
  })
  it('2+ técnicos sem justificativa concreta: ajustado para 1', async () => {
    const model = new MockStructuredModel(() => ({ output: laborFixture({ technicians: 3, service_hours: 2 }) }))
    const { ctx } = await stageContext({ stepResults: { diagnosis: diag(), materials: { items: [] } } })
    const r = ((await createLaborHandler({ model }).run(ctx)) as { result: { man_hours: number; labor: { technicians: number }; warnings: string[] } }).result
    expect(r.labor.technicians).toBe(1)
    expect(r.man_hours).toBe(2)
    expect(r.warnings.join(' ')).toMatch(/sem justificativa/i)
  })
  it('horas implausíveis viram aviso e pendência (não vira cotação absurda)', async () => {
    const model = new MockStructuredModel(() => ({ output: laborFixture({ service_hours: 80 }) }))
    const { ctx } = await stageContext({ stepResults: { diagnosis: diag(), materials: { items: [] } } })
    const out = await createLaborHandler({ model }).run(ctx)
    expect((out as { result: { labor: { service_hours: number } } }).result.labor.service_hours).toBe(24)
    expect((out as { pending: { code: string }[] }).pending.map((p) => p.code)).toContain('labor_hours_check')
  })
  it('o modelo nunca recebe valores comerciais (nem a palavra tarifa/rate no que ele vê dos dados)', async () => {
    const model = new MockStructuredModel(() => ({ output: laborFixture() }))
    const { ctx } = await stageContext({ stepResults: { diagnosis: diag(), materials: { items: [] } } })
    await createLaborHandler({ model }).run(ctx)
    const seen = `${model.calls[0]!.system}\n${model.calls[0]!.userText}`
    expect(seen).not.toMatch(/\$\s?\d|per hour|hourly|margin|markup|40|billed/i)
  })
})
