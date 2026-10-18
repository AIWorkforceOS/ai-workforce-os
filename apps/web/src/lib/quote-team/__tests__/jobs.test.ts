import { describe, expect, it } from 'vitest'
import { buildIdempotencyKey, decidePhotoPolicy, enqueueQuoteJob } from '../jobs'
import { InMemoryJobStore } from '../job-store'

const unit = { id: 'u1', org_id: 'o1', mode: 'shadow' as const }
const base = { unit, appointmentId: 'a1', orderStatus: 'quote', notes: 'Porta não fecha', mediaUrls: ['https://x/1.jpg', 'https://x/2.jpg'] }

describe('chave de idempotência', () => {
  it('mesma entrada (em qualquer ordem das fotos e com espaços extras) = mesma chave', () => {
    const a = buildIdempotencyKey({ appointmentId: 'a', notes: 'Porta  não fecha', mediaUrls: ['b', 'a'] })
    const b = buildIdempotencyKey({ appointmentId: 'a', notes: 'Porta não fecha ', mediaUrls: ['a', 'b', 'a'] })
    expect(a).toBe(b)
  })
  it('nota diferente, foto nova, regra comercial nova ou nonce de reanálise = chave nova', () => {
    const k = buildIdempotencyKey({ appointmentId: 'a', notes: 'n', mediaUrls: ['a'] })
    expect(buildIdempotencyKey({ appointmentId: 'a', notes: 'n2', mediaUrls: ['a'] })).not.toBe(k)
    expect(buildIdempotencyKey({ appointmentId: 'a', notes: 'n', mediaUrls: ['a', 'b'] })).not.toBe(k)
    expect(buildIdempotencyKey({ appointmentId: 'a', notes: 'n', mediaUrls: ['a'], rateCardId: 'r' })).not.toBe(k)
    expect(buildIdempotencyKey({ appointmentId: 'a', notes: 'n', mediaUrls: ['a'], nonce: '1' })).not.toBe(k)
  })
})

describe('política de fotos (padrão 5, exceção justificada, nunca bloqueia)', () => {
  it('sem foto: só organiza texto, sem diagnóstico visual', () => {
    const p = decidePhotoPolicy({ photoCount: 0 })
    expect(p.visualAnalysis).toBe(false)
    expect(p.notes_pt[0]).toMatch(/não faz diagnóstico visual/)
  })
  it('menos de 5 sem motivo: orienta; com motivo: aceita; 5+: ok', () => {
    expect(decidePhotoPolicy({ photoCount: 3 })).toMatchObject({ belowStandard: true, missing: 2, exceptionAccepted: false })
    expect(decidePhotoPolicy({ photoCount: 3, exceptionReason: 'serviço simples' })).toMatchObject({ exceptionAccepted: true })
    expect(decidePhotoPolicy({ photoCount: 5 })).toMatchObject({ belowStandard: false, missing: 0, notes_pt: [] })
  })
})

describe('enqueueQuoteJob', () => {
  it('cria 1 job e, salvando de novo (ou reenvio da fila), devolve o MESMO — sem duplicar', async () => {
    const store = new InMemoryJobStore()
    const a = await enqueueQuoteJob({ store, pipelineReady: true }, base)
    const b = await enqueueQuoteJob({ store, pipelineReady: true }, base)
    expect(a.status).toBe('enqueued')
    expect(b.status).toBe('existing')
    expect(store.jobs.size).toBe(1)
    expect(a.status !== 'skipped' && b.status !== 'skipped' && a.job.id === b.job.id).toBe(true)
  })
  it('guarda só ids/URLs/textos — nenhum valor comercial no snapshot', async () => {
    const store = new InMemoryJobStore()
    const out = await enqueueQuoteJob({ store, pipelineReady: true }, { ...base, rateCardId: 'rate-1' })
    expect(JSON.stringify(out.status === 'skipped' ? {} : out.job.input_snapshot)).not.toMatch(/40|20|hourly|markup/)
  })
  it('modo off, ordem que não é cotação, pipeline pronto = false e sem conteúdo NÃO criam job', async () => {
    const store = new InMemoryJobStore()
    expect(await enqueueQuoteJob({ store, pipelineReady: true }, { ...base, unit: { ...unit, mode: 'off' } })).toEqual({ status: 'skipped', reason: 'mode_off' })
    expect(await enqueueQuoteJob({ store, pipelineReady: true }, { ...base, orderStatus: 'completed' })).toEqual({ status: 'skipped', reason: 'not_quote' })
    expect(await enqueueQuoteJob({ store, pipelineReady: false }, base)).toEqual({ status: 'skipped', reason: 'pipeline_not_ready' })
    expect(await enqueueQuoteJob({ store, pipelineReady: true }, { ...base, notes: ' ', mediaUrls: [] })).toEqual({ status: 'skipped', reason: 'no_content' })
    expect(store.jobs.size).toBe(0)
  })
  it('reanálise pedida (nonce) cria job novo; modo shadow vs live é herdado da unidade', async () => {
    const store = new InMemoryJobStore()
    const first = await enqueueQuoteJob({ store, pipelineReady: true }, base)
    const again = await enqueueQuoteJob({ store, pipelineReady: true }, { ...base, trigger: 'reanalyze', nonce: 'n1', parentJobId: first.status === 'skipped' ? null : first.job.id, unit: { ...unit, mode: 'live' } })
    expect(store.jobs.size).toBe(2)
    expect(again.status === 'skipped' ? null : again.job.mode).toBe('live')
  })
})
