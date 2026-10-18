import { describe, expect, it, vi } from 'vitest'

/** Implantação com o módulo desligado/sem etapas: o cron e o gancho de salvar NÃO podem tocar no banco nem mudar o comportamento das ordens. */
const createServiceClient = vi.fn(() => {
  throw new Error('não deveria tocar no banco')
})
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => createServiceClient() }))

describe('/api/cron/quote-jobs com o módulo inerte', () => {
  it('sem etapas registradas responde 200 "skipped" sem criar cliente de banco', async () => {
    vi.stubEnv('CRON_SECRET', 's3cret')
    const { GET } = await import('../route')
    const res = await GET(new Request('http://x/api/cron/quote-jobs', { headers: { authorization: 'Bearer s3cret' } }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ skipped: 'pipeline_not_ready_or_disabled' })
    expect(createServiceClient).not.toHaveBeenCalled()
  })
  it('exige o segredo do cron', async () => {
    vi.stubEnv('CRON_SECRET', 's3cret')
    const { GET } = await import('../route')
    expect((await GET(new Request('http://x', { headers: { authorization: 'Bearer errado' } }))).status).toBe(401)
  })
  it('com QUOTE_TEAM_ENABLED=false também fica inerte', async () => {
    vi.stubEnv('CRON_SECRET', 's3cret')
    vi.stubEnv('QUOTE_TEAM_ENABLED', 'false')
    const { GET } = await import('../route')
    expect(await (await GET(new Request('http://x', { headers: { authorization: 'Bearer s3cret' } }))).json()).toEqual({ skipped: 'pipeline_not_ready_or_disabled' })
    expect(createServiceClient).not.toHaveBeenCalled()
  })
})

describe('gancho ao salvar a ordem com o módulo inerte', () => {
  it('não faz nenhuma chamada ao banco e devolve "skipped" (a ordem salva como hoje)', async () => {
    const { maybeEnqueueQuoteAnalysis } = await import('@/lib/quote-team/server')
    const db = new Proxy({}, { get: () => { throw new Error('não deveria tocar no banco') } })
    const out = await maybeEnqueueQuoteAnalysis(db as never, { unitId: 'u', appointmentId: 'a', orderStatus: 'quote', notes: 'x', photos: [{ url: 'https://x/y.jpg' }] })
    expect(out).toEqual({ status: 'skipped', reason: 'pipeline_not_ready' })
  })
})
