import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QUOTE_STAGES } from '@/lib/quote-team/config'
import { InMemoryJobStore } from '@/lib/quote-team/job-store'

/**
 * Garantias do piloto no nível das rotas: aprovar NÃO mexe na WO nem envia nada a ninguém; "Gerar" respeita os tetos do lote.
 */
const kicks: string[] = []
vi.mock('@vercel/functions', () => ({ waitUntil: () => undefined }))
vi.mock('@/lib/quote-team/server', async (orig) => ({ ...(await orig<Record<string, unknown>>()), kickQuoteJob: async (_o: string, id: string) => void kicks.push(id) }))
vi.mock('@/lib/quote-team/agent/media', () => ({ verifyStoredMedia: async (urls: string[]) => ({ present: urls, missing: [] }), storageHosts: () => ['x.supabase.co'] }))
vi.mock('@/lib/quote-team/handlers', () => ({ QUOTE_STAGE_HANDLERS: Object.fromEntries(QUOTE_STAGES.map((s) => [s, { needsAi: false, run: async () => ({ kind: 'done', result: s }) }])) }))
const loadAgentContext = vi.fn()
const buildAgentState = vi.fn(async () => ({ ok: true }))
vi.mock('@/lib/quote-team/agent/server', () => ({ loadAgentContext: (...a: unknown[]) => loadAgentContext(...a), buildAgentState: () => buildAgentState() }))

type Call = { table?: string; rpc?: string; op: string; payload?: unknown }
function makeDb(opts: { limits?: Record<string, unknown> | null; monthTotal?: number; jobCount?: number; draft?: Record<string, unknown> | null } = {}) {
  const calls: Call[] = []
  const from = (table: string) => {
    const q: Record<string, unknown> = {}
    const chain = (op: string) => (...args: unknown[]) => { calls.push({ table, op, payload: args[0] }); return q }
    Object.assign(q, {
      select: chain('select'), eq: chain('eq'), order: chain('order'), limit: chain('limit'), insert: chain('insert'), update: chain('update'), upsert: chain('upsert'),
      maybeSingle: async () => ({ data: table === 'quote_org_limits' ? opts.limits ?? null : table === 'quote_drafts' ? opts.draft ?? null : null, error: null }),
      single: async () => ({ data: null, error: null }),
      then: (resolve: (v: unknown) => void) => resolve({ data: [], count: table === 'quote_analysis_jobs' ? opts.jobCount ?? 0 : 0, error: null }),
    })
    return q
  }
  return { calls, db: { from, rpc: async (fn: string, args: unknown) => { calls.push({ rpc: fn, op: 'rpc', payload: args }); return { data: fn === 'quote_org_budget_report' ? [{ total_usd: opts.monthTotal ?? 0 }] : null, error: null } } } }
}

const ctxFor = (db: unknown, over: Record<string, unknown> = {}) => ({
  ok: true,
  ctx: { actor: 'technician', appUser: { id: 'usr-1' }, db, store: new InMemoryJobStore(), unit: { id: 'u1', org_id: 'o1', mode: 'live' }, appointment: { id: 'a1', unit_id: 'u1', service_order_status: 'quote', service_order_material_description: 'Porta não fecha', service_order_photos: [{ url: 'https://x.supabase.co/a.jpg', kind: 'before' }], service_order_number: '1', ...over } },
})
const req = (body: unknown = {}) => new Request('http://x/api', { method: 'POST', body: JSON.stringify(body) })
const params = { params: Promise.resolve({ id: 'u1', appointmentId: 'a1' }) }

describe('aprovar a cotação técnica', () => {
  beforeEach(() => loadAgentContext.mockReset())
  it('só chama a aprovação da cotação: NÃO altera a WO (status, assinatura), NÃO conclui o serviço e NÃO envia nada a ninguém', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const { calls, db } = makeDb({ draft: { id: 'd1', status: 'draft', technical_check: 'ready_for_review', version: 1, job_id: 'j1' } })
    loadAgentContext.mockResolvedValue(ctxFor(db))
    const { POST } = await import('../approve/route')
    const res = await POST(req(), params)
    expect(res.status).toBe(200)
    expect(calls.find((c) => c.rpc === 'approve_quote_draft')).toBeTruthy()
    const tables = new Set(calls.map((c) => c.table).filter(Boolean))
    expect(tables.has('appointments')).toBe(false)
    expect(tables.has('invoices')).toBe(false)
    expect(calls.some((c) => c.table === 'appointments' && ['update', 'insert', 'upsert'].includes(c.op))).toBe(false)
    // nenhuma chamada de rede de saída (nada é enviado à Facilities 360 nem a e-mail/WhatsApp)
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })
  it('cotação bloqueada por informação crítica não é aprovada', async () => {
    const { db } = makeDb({ draft: { id: 'd1', status: 'draft', technical_check: 'blocked', version: 1 } })
    loadAgentContext.mockResolvedValue(ctxFor(db))
    const { POST } = await import('../approve/route')
    expect((await POST(req(), params)).status).toBe(409)
  })
  it('sem rascunho para aprovar: 409', async () => {
    const { db } = makeDb({ draft: null })
    loadAgentContext.mockResolvedValue(ctxFor(db))
    const { POST } = await import('../approve/route')
    expect((await POST(req(), params)).status).toBe(409)
  })
})

describe('gerar cotação — tetos do lote', () => {
  beforeEach(() => {
    loadAgentContext.mockReset()
    kicks.length = 0
    vi.stubEnv('CRON_SECRET', 's')
  })
  it('limite mensal da empresa atingido (lote de US$ 3,00): nem começa', async () => {
    const { db } = makeDb({ limits: { monthly_cap_usd: 3, per_quote_cap_usd: 0.6, pilot_max_quotes: null }, monthTotal: 3.01 })
    const c = ctxFor(db)
    loadAgentContext.mockResolvedValue(c)
    const { POST } = await import('../generate/route')
    const res = await POST(req(), params)
    expect(res.status).toBe(409)
    expect((await res.json()).reason).toBe('monthly_cap')
    expect(c.ctx.store.jobs.size).toBe(0)
  })
  it('máximo de 10 cotações no lote: a 11ª é recusada; a cotação que já existe continua', async () => {
    const { db } = makeDb({ limits: { monthly_cap_usd: 3, per_quote_cap_usd: 0.6, pilot_max_quotes: 10 }, jobCount: 10 })
    const c = ctxFor(db)
    loadAgentContext.mockResolvedValue(c)
    const { POST } = await import('../generate/route')
    const res = await POST(req(), params)
    expect(res.status).toBe(409)
    expect((await res.json()).reason).toBe('max_quotes')
  })
  it('dentro dos limites: cria UM job com teto por cotação de no máximo US$ 0,60 e dispara o processamento', async () => {
    const { db } = makeDb({ limits: { monthly_cap_usd: 3, per_quote_cap_usd: 5, pilot_max_quotes: 10 }, monthTotal: 0.4, jobCount: 3 })
    const c = ctxFor(db)
    loadAgentContext.mockResolvedValue(c)
    const { POST } = await import('../generate/route')
    const res = await POST(req(), params)
    expect(res.status).toBe(202)
    const jobs = [...c.ctx.store.jobs.values()]
    expect(jobs).toHaveLength(1)
    expect(jobs[0]!.budget_usd).toBe(0.6) // per_quote_cap de 5 é cortado no máximo da plataforma
    expect(jobs[0]!.mode).toBe('live')
  })
  it('teto menor por cotação configurado pela empresa é respeitado', async () => {
    const { db } = makeDb({ limits: { monthly_cap_usd: 3, per_quote_cap_usd: 0.3, pilot_max_quotes: null } })
    const c = ctxFor(db)
    loadAgentContext.mockResolvedValue(c)
    const { POST } = await import('../generate/route')
    await POST(req(), params)
    expect([...c.ctx.store.jobs.values()][0]!.budget_usd).toBe(0.3)
  })
  it('ordem que não é "Cotação" ou sem descrição/foto: não gera', async () => {
    const { db } = makeDb()
    loadAgentContext.mockResolvedValue(ctxFor(db, { service_order_status: 'completed' }))
    const { POST } = await import('../generate/route')
    expect((await POST(req(), params)).status).toBe(409)
    loadAgentContext.mockResolvedValue(ctxFor(db, { service_order_material_description: ' ', service_order_photos: [] }))
    expect((await POST(req(), params)).status).toBe(409)
  })
})
