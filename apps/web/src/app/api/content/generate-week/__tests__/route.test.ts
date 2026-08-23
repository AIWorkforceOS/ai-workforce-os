import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'

const generateWeekPostsForAccountMock = vi.fn(async () => ({ created: 3, skipped: 0, errors: [] }))

function makeRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/content/generate-week', { method: 'POST', body: JSON.stringify(body) })
}

async function loadRoute(supabase: unknown) {
  vi.doMock('@/lib/supabase/server', () => ({ createClient: async () => supabase }))
  vi.doMock('@/lib/supabase/service', () => ({ createServiceClient: () => supabase }))
  vi.doMock('@/lib/openai', () => ({ getOpenAIApiKey: () => 'sk-test' }))
  vi.doMock('@/lib/content/weekly-planner', () => ({ generateWeekPostsForAccount: generateWeekPostsForAccountMock }))
  return import('../route')
}

describe('POST /api/content/generate-week', () => {
  beforeEach(() => {
    vi.resetModules()
    generateWeekPostsForAccountMock.mockClear()
  })

  it('401 sem sessão autenticada', async () => {
    const { supabase } = createFakeSupabase({})
    Object.assign(supabase, { auth: { getUser: async () => ({ data: { user: null } }) } })
    const { POST } = await loadRoute(supabase)

    const res = await POST(makeRequest({ unit_id: 'unit-1' }))
    expect(res.status).toBe(401)
  })

  it('400 sem unit_id', async () => {
    const { supabase } = createFakeSupabase({})
    Object.assign(supabase, { auth: { getUser: async () => ({ data: { user: { id: 'auth-1' } } }) } })
    const { POST } = await loadRoute(supabase)

    const res = await POST(makeRequest({}))
    expect(res.status).toBe(400)
  })

  it('404 sem nenhuma conta conectada', async () => {
    const { supabase } = createFakeSupabase({
      units: [{ id: 'unit-1' }],
      agent_configs: [{ id: 'cfg-1', unit_id: 'unit-1', agent_type: 'content_specialist', is_active: true, business_profile: {} }],
      social_accounts: [],
    })
    Object.assign(supabase, { auth: { getUser: async () => ({ data: { user: { id: 'auth-1' } } }) } })
    const { POST } = await loadRoute(supabase)

    const res = await POST(makeRequest({ unit_id: 'unit-1' }))
    expect(res.status).toBe(404)
  })

  it('gera o planejamento pra cada conta conectada, somando os totais', async () => {
    const { supabase } = createFakeSupabase({
      units: [{ id: 'unit-1' }],
      agent_configs: [{ id: 'cfg-1', unit_id: 'unit-1', agent_type: 'content_specialist', is_active: true, business_profile: {} }],
      social_accounts: [
        { id: 'acc-1', unit_id: 'unit-1', is_active: true, connection_status: 'connected', page_name: 'Página 1' },
        { id: 'acc-2', unit_id: 'unit-1', is_active: true, connection_status: 'connected', page_name: 'Página 2' },
      ],
    })
    Object.assign(supabase, { auth: { getUser: async () => ({ data: { user: { id: 'auth-1' } } }) } })
    const { POST } = await loadRoute(supabase)

    const res = await POST(makeRequest({ unit_id: 'unit-1' }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.created).toBe(6) // 3 por conta, 2 contas
    expect(generateWeekPostsForAccountMock).toHaveBeenCalledTimes(2)
    expect(Array.isArray(json.dates)).toBe(true)
    expect(json.dates.length).toBeGreaterThan(0)
  })
})
