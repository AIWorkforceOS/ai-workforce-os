import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QUOTE_STAGES } from '@/lib/quote-team/config'
import type * as JobStoreModule from '@/lib/quote-team/job-store'
import { InMemoryJobStore } from '@/lib/quote-team/job-store'
import { enqueueQuoteJob } from '@/lib/quote-team/jobs'

const store = new InMemoryJobStore()
const background: Promise<unknown>[] = []
let handlers: Record<string, unknown> = {}
const getAppUser = vi.fn().mockResolvedValue(null)

vi.mock('@vercel/functions', () => ({ waitUntil: (p: Promise<unknown>) => void background.push(p) }))
vi.mock('@/lib/app-user', () => ({ getAppUser: () => getAppUser() }))
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({}) }))
vi.mock('@/lib/quote-team/job-store', async (orig) => ({ ...(await orig<typeof JobStoreModule>()), SupabaseJobStore: class { constructor() { return store } } }))
vi.mock('@/lib/quote-team/agent/lifecycle', () => ({ createRunnerHooks: () => ({}) }))
vi.mock('@/lib/quote-team/handlers', () => ({ get QUOTE_STAGE_HANDLERS() { return handlers } }))

const call = async (auth?: string) => {
  const { POST } = await import('../route')
  return POST(new Request('http://x/api/quote-jobs/job-1/run', { method: 'POST', headers: auth ? { authorization: auth } : {} }), { params: Promise.resolve({ id: 'job-1' }) })
}

describe('/api/quote-jobs/[id]/run — disparo imediato servidor-a-servidor', () => {
  beforeEach(() => {
    vi.stubEnv('CRON_SECRET', 's3cret')
    vi.stubEnv('QUOTE_TEAM_ENABLED', '')
    background.length = 0
    getAppUser.mockClear()
    store.jobs.clear()
    handlers = {}
  })

  it('sem etapas registradas (hoje): 409 mesmo com o segredo certo — nada executa', async () => {
    expect((await call('Bearer s3cret')).status).toBe(409)
    expect(background).toHaveLength(0)
  })
  it('segredo errado ou ausente: cai na autenticação de usuário (sem sessão = 401)', async () => {
    expect((await call('Bearer errado')).status).toBe(401)
    expect((await call()).status).toBe(401)
  })
  it('com etapas e segredo certo: responde 202 na hora e conclui em segundo plano, SEM sessão de usuário/navegador', async () => {
    handlers = Object.fromEntries(QUOTE_STAGES.map((s) => [s, { needsAi: false, run: async () => ({ kind: 'done', result: s }) }]))
    await enqueueQuoteJob({ store, pipelineReady: true }, { unit: { id: 'u', org_id: 'o', mode: 'shadow' }, appointmentId: 'a1', orderStatus: 'quote', notes: 'x', mediaUrls: [], trigger: 'save' })
    const res = await call('Bearer s3cret')
    expect(res.status).toBe(202)
    expect(getAppUser).not.toHaveBeenCalled()
    await Promise.all(background)
    expect((await store.get('job-1'))!.status).toBe('completed')
  })
  it('kill switch QUOTE_TEAM_ENABLED=false desliga também o disparo imediato', async () => {
    vi.stubEnv('QUOTE_TEAM_ENABLED', 'false')
    handlers = Object.fromEntries(QUOTE_STAGES.map((s) => [s, { needsAi: false, run: async () => ({ kind: 'done', result: s }) }]))
    expect((await call('Bearer s3cret')).status).toBe(409)
  })
})
