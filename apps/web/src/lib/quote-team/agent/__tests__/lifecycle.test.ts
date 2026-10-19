import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'
import { QUOTE_STAGES, QUOTE_MAX_ROUNDS } from '../../config'
import { InMemoryJobStore } from '../../job-store'
import { runQuoteJob, type StageHandlers } from '../../runner'
import { toTechnicianDraftView } from '../../visibility'
import { createAuditHandler } from '../audit'
import type { RateCardInput } from '../commercial'
import { createCostingHandler } from '../costing'
import { applyDraftEdits, DraftEditError } from '../edit'
import { createLaborHandler } from '../labor'
import { createRunnerHooks, startQuoteAnalysis, submitTechnicianInput } from '../lifecycle'
import { createMaterialsHandler } from '../materials'
import { listQuoteMessages } from '../messages'
import { createPricingHandler } from '../pricing'
import { MockStructuredModel } from '../structured-model'
import { diagnosisFixture, laborFixture, materialsFixture } from './helpers'

const unit = { id: 'unit-1', org_id: 'org-1', mode: 'live' as const }
const start = (over = {}) => ({ unit, appointmentId: 'appt-1', orderStatus: 'quote', notes: 'Porta não fecha', mediaUrls: ['https://x.supabase.co/a.jpg'], createdBy: 'user-1', ...over })
const rateCard: RateCardInput = { id: 'rc1', billed_hourly_rate: 40, technician_hourly_pay: 20, min_billable_hours: null, travel_fee_flat: null, travel_fee_hourly: null, materials_markup_pct: null, tax_rules: null, rounding_rule: null }

type Script = { diagnosis?: () => ReturnType<typeof diagnosisFixture>; needLabel?: boolean }
function makePipeline(script: Script = {}) {
  const calls = { diagnosis: 0, materials: 0, labor: 0 }
  const model = new MockStructuredModel((input) => {
    if (input.schemaName === 'quote_materials') {
      calls.materials += 1
      const needs = script.needLabel && calls.materials === 1
      return { output: materialsFixture([{ name_en: 'Door closer', quantity: 1 }, { name_en: 'Screws', kind: 'consumable', quantity: 6, unit: 'ea' }], needs ? [{ kind: 'label', request_pt: 'Foto da etiqueta da mola' }] : []) }
    }
    calls.labor += 1
    return { output: laborFixture() }
  })
  const handlers: StageHandlers = {
    diagnosis: { needsAi: true, run: async (ctx) => { calls.diagnosis += 1; const d = (script.diagnosis ?? (() => diagnosisFixture()))(); void ctx; return { kind: 'done', result: { diagnosis: d, warnings: [] } } } },
    materials: createMaterialsHandler({ model }),
    pricing: createPricingHandler({ model, enabled: () => false }),
    labor: createLaborHandler({ model }),
    costing: createCostingHandler({ loadRateCard: async () => rateCard }),
    audit: createAuditHandler(),
  }
  return { handlers, calls }
}

async function setup(script: Script = {}) {
  const store = new InMemoryJobStore()
  const db: SupabaseClient = createFakeSupabase({}).supabase
  const pipeline = makePipeline(script)
  const run = () => runQuoteJob({ store, handlers: pipeline.handlers, hooks: createRunnerHooks({ db, store }), worker: 'w' }, null)
  return { store, db, run, ...pipeline }
}

describe('início da análise (só no clique)', () => {
  it('unidade desligada, ordem que não é cotação ou sem conteúdo: nada é criado', async () => {
    const store = new InMemoryJobStore()
    expect(await startQuoteAnalysis({ store }, start({ unit: { ...unit, mode: 'off' } }))).toEqual({ status: 'skipped', reason: 'mode_off' })
    expect(await startQuoteAnalysis({ store }, start({ orderStatus: 'completed' }))).toEqual({ status: 'skipped', reason: 'not_quote' })
    expect(await startQuoteAnalysis({ store }, start({ notes: ' ', mediaUrls: [] }))).toEqual({ status: 'skipped', reason: 'no_content' })
    expect(store.jobs.size).toBe(0)
  })
  it('um job por WO: clicar de novo não duplica nem gasta de novo', async () => {
    const store = new InMemoryJobStore()
    const first = await startQuoteAnalysis({ store }, start())
    expect(first.status).toBe('started')
    const again = await startQuoteAnalysis({ store }, start())
    expect(again.status).toBe('already_running')
    expect(store.jobs.size).toBe(1)
  })
})

describe('pipeline completo com conversa', () => {
  it('gera rascunho v1 completo; técnico não vê nada comercial; admin tem a camada comercial', async () => {
    const t = await setup()
    await startQuoteAnalysis({ store: t.store }, start())
    const out = await t.run()
    expect(out.kind).toBe('completed')
    const drafts = (await (t.db.from('quote_drafts').select('*') as unknown as Promise<{ data: Record<string, unknown>[] }>)).data
    expect(drafts).toHaveLength(1)
    expect(drafts[0]).toMatchObject({ version: 1, status: 'draft', technical_check: 'needs_confirmation' }) // preços pendentes (busca desligada)
    const items = (await (t.db.from('quote_items').select('*') as unknown as Promise<{ data: Record<string, unknown>[] }>)).data
    expect(items).toHaveLength(2)
    expect(items.every((i) => i.price_status === 'pending' && i.unit_price_micros === null)).toBe(true)
    const labor = (await (t.db.from('quote_labor_plan').select('*') as unknown as Promise<{ data: Record<string, unknown>[] }>)).data[0]!
    expect(labor).toMatchObject({ technicians: 1, service_hours: 1.5, man_hours: 1.5 })
    const commercial = (await (t.db.from('quote_commercial').select('*') as unknown as Promise<{ data: Record<string, unknown>[] }>)).data[0]!
    expect(commercial.billed_labor_micros).toBe(60_000_000) // 1,5 h-homem × US$ 40
    expect(commercial.internal_labor_cost_micros).toBe(30_000_000)
    // a visão do técnico não contém nada comercial (e o detector de vazamento está embutido no serializador)
    const view = toTechnicianDraftView({ draft: drafts[0]!, items, options: [], labor, media: [] })
    expect(JSON.stringify(view)).not.toMatch(/billed|internal_labor|margin|rate_card/i)
    // o rascunho técnico guardado também não carrega comercial
    expect(JSON.stringify(drafts[0]!.ai_original)).not.toMatch(/billed|internal_labor|margin|rate_card|commercial/i)
    const messages = await listQuoteMessages(t.db, 'appt-1')
    expect(messages.map((m) => m.kind)).toEqual(['status'])
  })

  it('agente pergunta (needs_input) → técnico responde com foto → nova versão; orçamento da cotação ACUMULA', async () => {
    const t = await setup({ needLabel: true })
    const started = await startQuoteAnalysis({ store: t.store }, start())
    const job1 = await t.run()
    expect(job1.kind).toBe('needs_input')
    const q = (await listQuoteMessages(t.db, 'appt-1'))[0]!
    expect(q).toMatchObject({ role: 'agent', kind: 'question' })
    expect(q.questions[0]).toMatchObject({ kind: 'label', request_pt: 'Foto da etiqueta da mola' })
    expect(q.body).toContain('etiqueta')

    const jobId = (started as { job: { id: string } }).job.id
    const spentBefore = (await t.store.get(jobId))!.spent_usd
    const reopened = await submitTechnicianInput({ store: t.store }, { job: (await t.store.get(jobId))!, kind: 'answer', body: 'Segue a etiqueta', newMediaUrls: ['https://x.supabase.co/etiqueta.jpg'] })
    expect(reopened.status).toBe('reopened')
    const row = (await t.store.get(jobId))!
    expect(row.status).toBe('queued')
    expect(row.rounds).toBe(2)
    expect(row.spent_usd).toBe(spentBefore) // reabrir NÃO zera o gasto
    expect((row.input_snapshot as { media_urls: string[] }).media_urls).toContain('https://x.supabase.co/etiqueta.jpg')
    expect((row.input_snapshot as { conversation: { body: string }[] }).conversation[0]!.body).toBe('Segue a etiqueta')

    expect((await t.run()).kind).toBe('completed')
    expect(t.calls.diagnosis).toBe(2)
    const after = (await t.store.get(jobId))!
    expect(after.spent_usd).toBeGreaterThanOrEqual(spentBefore) // acumulado, nunca reiniciado
    expect(after.budget_usd).toBe(0.6)
  })

  it('pedido de revisão gera NOVA versão e preserva o histórico (v1 superseded, imutável)', async () => {
    const t = await setup()
    const started = await startQuoteAnalysis({ store: t.store }, start())
    await t.run()
    const jobId = (started as { job: { id: string } }).job.id
    expect((await submitTechnicianInput({ store: t.store }, { job: (await t.store.get(jobId))!, kind: 'revision_request', body: 'Considere reparar em vez de substituir', newMediaUrls: [] })).status).toBe('reopened')
    await t.run()
    const drafts = (await (t.db.from('quote_drafts').select('*') as unknown as Promise<{ data: Record<string, unknown>[] }>)).data
    expect(drafts.map((d) => [d.version, d.status]).sort()).toEqual([[1, 'superseded'], [2, 'draft']])
  })

  it('limites: rodadas máximas, job em andamento, orçamento esgotado e mensagem vazia são recusados', async () => {
    const store = new InMemoryJobStore()
    const started = await startQuoteAnalysis({ store }, start())
    const id = (started as { job: { id: string } }).job.id
    expect((await submitTechnicianInput({ store }, { job: (await store.get(id))!, kind: 'answer', body: 'x', newMediaUrls: [] })).status).toBe('rejected') // queued = ocupado
    await store.update(id, { status: 'completed', rounds: QUOTE_MAX_ROUNDS })
    expect(await submitTechnicianInput({ store }, { job: (await store.get(id))!, kind: 'answer', body: 'x', newMediaUrls: [] })).toEqual({ status: 'rejected', reason: 'max_rounds' })
    await store.update(id, { rounds: 1 })
    expect(await submitTechnicianInput({ store }, { job: (await store.get(id))!, kind: 'answer', body: '  ', newMediaUrls: [] })).toEqual({ status: 'rejected', reason: 'empty' })
    await store.update(id, { status: 'budget_exhausted' })
    expect(await submitTechnicianInput({ store }, { job: (await store.get(id))!, kind: 'answer', body: 'x', newMediaUrls: [] })).toEqual({ status: 'rejected', reason: 'budget_exhausted' })
  })

  it('"continuar sem essas informações" marca no_more_questions e segue (sem mais bloqueio)', async () => {
    const t = await setup({ needLabel: true })
    const started = await startQuoteAnalysis({ store: t.store }, start())
    await t.run()
    const id = (started as { job: { id: string } }).job.id
    await submitTechnicianInput({ store: t.store }, { job: (await t.store.get(id))!, kind: 'answer', body: '', newMediaUrls: [], skipQuestions: true })
    expect(((await t.store.get(id))!.input_snapshot as { no_more_questions: boolean }).no_more_questions).toBe(true)
    expect((await t.run()).kind).toBe('completed')
  })

  it('falha ao gravar o rascunho deixa o job "failed" e retomável (etapas guardadas, sem refazer chamadas)', async () => {
    const t = await setup()
    const failingDb: SupabaseClient = createFakeSupabase({}, { quote_drafts: { insert: 'disco cheio' } }).supabase
    const run = () => runQuoteJob({ store: t.store, handlers: t.handlers, hooks: createRunnerHooks({ db: failingDb, store: t.store }), worker: 'w' }, null)
    const started = await startQuoteAnalysis({ store: t.store }, start())
    await run()
    const id = (started as { job: { id: string } }).job.id
    const failed = (await t.store.get(id))!
    expect(failed).toMatchObject({ status: 'failed', error_code: 'draft_write_failed' })
    const callsBefore = { ...t.calls }
    expect((await startQuoteAnalysis({ store: t.store }, start())).status).toBe('retried')
    expect((await t.run()).kind).toBe('completed')
    expect(t.calls).toEqual(callsBefore) // nenhuma etapa foi refeita
    expect(QUOTE_STAGES.every((s) => s in (failed.step_results as object))).toBe(true)
  })
})

describe('edição do rascunho', () => {
  async function withDraft() {
    const t = await setup()
    await startQuoteAnalysis({ store: t.store }, start())
    await t.run()
    const draft = ((await (t.db.from('quote_drafts').select('*') as unknown as Promise<{ data: Record<string, unknown>[] }>)).data)[0]!
    const items = (await (t.db.from('quote_items').select('*') as unknown as Promise<{ data: Record<string, unknown>[] }>)).data
    return { ...t, draftId: String(draft.id), items }
  }

  it('técnico preenche preço de compra/fornecedor/link: vira "corrigido pelo técnico", recalcula totais e a camada comercial acompanha', async () => {
    const t = await withDraft()
    await applyDraftEdits(t.db, t.draftId, { items: [{ id: String(t.items[0]!.id), unit_price_usd: 29.97, supplier: 'Home Depot', product_url: 'https://www.homedepot.com/p/closer/123', quantity: 2 }] }, { id: 'user-1', role: 'technician' })
    const item = ((await (t.db.from('quote_items').select('*').eq('id', t.items[0]!.id) as unknown as Promise<{ data: Record<string, unknown>[] }>)).data)[0]!
    expect(item).toMatchObject({ unit_price_micros: 29_970_000, price_status: 'technician_corrected', price_source: 'manual', supplier: 'Home Depot', quantity: 2, edited_by_technician: true })
    const draft = ((await (t.db.from('quote_drafts').select('*').eq('id', t.draftId) as unknown as Promise<{ data: Record<string, unknown>[] }>)).data)[0]!
    expect(draft).toMatchObject({ materials_total_micros: 59_940_000, pending_price_count: 1 })
    expect(draft.edited_fields).toContain('items')
    const commercial = ((await (t.db.from('quote_commercial').select('*') as unknown as Promise<{ data: Record<string, unknown>[] }>)).data)[0]!
    expect(commercial.commercial_total_micros).toBe(60_000_000 + 59_940_000)
  })
  it('limpar o preço volta a "pendente"; adicionar e remover itens funciona', async () => {
    const t = await withDraft()
    await applyDraftEdits(t.db, t.draftId, { items: [{ id: String(t.items[0]!.id), unit_price_usd: 10 }] }, { id: 'u', role: 'technician' })
    await applyDraftEdits(t.db, t.draftId, { items: [{ id: String(t.items[0]!.id), unit_price_usd: null }], add_items: [{ name_en: 'Silicone', quantity: 1, unit: 'tube', unit_price_usd: 8.5 }], remove_item_ids: [String(t.items[1]!.id)] }, { id: 'u', role: 'technician' })
    const items = (await (t.db.from('quote_items').select('*') as unknown as Promise<{ data: Record<string, unknown>[] }>)).data
    expect(items.map((i) => [i.name_en, i.price_status])).toEqual([['Door closer', 'pending'], ['Silicone', 'technician_corrected']])
  })
  it('horas: 2 técnicos exigem justificativa; horas-homem recalculadas em código', async () => {
    const t = await withDraft()
    await expect(applyDraftEdits(t.db, t.draftId, { labor: { technicians: 2, service_hours: 2 } }, { id: 'u', role: 'technician' })).rejects.toThrow(/justificativa/)
    await applyDraftEdits(t.db, t.draftId, { labor: { technicians: 2, service_hours: 2, multi_technician_justification: 'Porta pesada' } }, { id: 'u', role: 'technician' })
    const labor = ((await (t.db.from('quote_labor_plan').select('*') as unknown as Promise<{ data: Record<string, unknown>[] }>)).data)[0]!
    expect(labor).toMatchObject({ technicians: 2, service_hours: 2, man_hours: 4, edited_by_technician: true })
    const commercial = ((await (t.db.from('quote_commercial').select('*') as unknown as Promise<{ data: Record<string, unknown>[] }>)).data)[0]!
    expect(commercial.billed_labor_micros).toBe(160_000_000)
  })
  it('versão aprovada ou substituída NÃO pode ser editada (409)', async () => {
    const t = await withDraft()
    await t.db.from('quote_drafts').update({ status: 'approved' }).eq('id', t.draftId)
    const err = await applyDraftEdits(t.db, t.draftId, { tech_text_pt: 'x' }, { id: 'u', role: 'technician' }).catch((e) => e)
    expect(err).toBeInstanceOf(DraftEditError)
    expect((err as DraftEditError).status).toBe(409)
  })
  it('item que não pertence à cotação é recusado', async () => {
    const t = await withDraft()
    await expect(applyDraftEdits(t.db, t.draftId, { items: [{ id: '00000000-0000-0000-0000-000000000000', quantity: 1 }] }, { id: 'u', role: 'technician' })).rejects.toThrow(/não pertence/)
  })
})

describe('desligar agora', () => {
  it('job cancelado enquanto roda: nenhuma etapa nova começa e nada mais é gasto', async () => {
    const store = new InMemoryJobStore()
    const calls = { diagnosis: 0, materials: 0 }
    const handlers: StageHandlers = Object.fromEntries(
      QUOTE_STAGES.map((stage) => [
        stage,
        {
          needsAi: false,
          run: async (ctx: { job: { id: string } }) => {
            if (stage === 'diagnosis') {
              calls.diagnosis += 1
              await store.update(ctx.job.id, { status: 'cancelled' }) // o admin tocou em "Desligar agora" no meio da etapa
            } else if (stage === 'materials') calls.materials += 1
            return { kind: 'done' as const, result: stage }
          },
        },
      ]),
    ) as StageHandlers
    await startQuoteAnalysis({ store }, start())
    const out = await runQuoteJob({ store, handlers, worker: 'w' }, null)
    expect(out.kind).toBe('yielded')
    expect(calls).toEqual({ diagnosis: 1, materials: 0 })
    expect((await store.get('job-1'))!.status).toBe('cancelled')
  })
  it('cancelado pode ser retomado depois (tentar de novo reaproveita o mesmo job)', async () => {
    const store = new InMemoryJobStore()
    const started = await startQuoteAnalysis({ store }, start())
    const id = (started as { job: { id: string } }).job.id
    await store.update(id, { status: 'cancelled' })
    expect((await startQuoteAnalysis({ store }, start())).status).toBe('retried')
    expect(store.jobs.size).toBe(1)
  })
})
