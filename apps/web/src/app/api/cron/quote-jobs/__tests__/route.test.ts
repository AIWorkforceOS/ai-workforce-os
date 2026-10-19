import { beforeEach, describe, expect, it, vi } from 'vitest'

/** Cron por minuto: autenticado, respeita o interruptor global e (com o módulo desligado) não faz trabalho nenhum. */
const createServiceClient = vi.fn(() => {
  throw new Error('não deveria tocar no banco')
})
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => createServiceClient() }))

describe('/api/cron/quote-jobs', () => {
  beforeEach(() => {
    createServiceClient.mockClear()
    vi.stubEnv('CRON_SECRET', 's3cret')
    vi.stubEnv('QUOTE_TEAM_ENABLED', '')
  })

  it('exige o segredo do cron (401 com segredo errado, 500 sem CRON_SECRET)', async () => {
    const { GET } = await import('../route')
    expect((await GET(new Request('http://x', { headers: { authorization: 'Bearer errado' } }))).status).toBe(401)
    vi.stubEnv('CRON_SECRET', '')
    expect((await GET(new Request('http://x', { headers: { authorization: 'Bearer s3cret' } }))).status).toBe(500)
  })
  it('com QUOTE_TEAM_ENABLED=false responde "skipped" sem criar cliente de banco', async () => {
    vi.stubEnv('QUOTE_TEAM_ENABLED', 'false')
    const { GET } = await import('../route')
    const res = await GET(new Request('http://x', { headers: { authorization: 'Bearer s3cret' } }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ skipped: 'pipeline_not_ready_or_disabled' })
    expect(createServiceClient).not.toHaveBeenCalled()
  })
})
