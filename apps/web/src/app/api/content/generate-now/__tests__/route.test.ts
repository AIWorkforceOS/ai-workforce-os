import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'

type MockOutcome = { ok: boolean; published?: boolean; post?: { id: string; status: string }; error?: string }

const generateSinglePostForAccountMock = vi.fn<() => Promise<MockOutcome>>(async () => ({
  ok: true,
  published: false,
  post: { id: 'post-1', status: 'pending_approval' },
}))

function makeRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/content/generate-now', { method: 'POST', body: JSON.stringify(body) })
}

async function loadRoute(supabase: unknown) {
  vi.doMock('@/lib/supabase/server', () => ({ createClient: async () => supabase }))
  vi.doMock('@/lib/supabase/service', () => ({ createServiceClient: () => supabase }))
  vi.doMock('@/lib/openai', () => ({ getOpenAIApiKey: () => 'sk-test' }))
  vi.doMock('@/lib/content/single-post', () => ({ generateSinglePostForAccount: generateSinglePostForAccountMock }))
  return import('../route')
}

describe('POST /api/content/generate-now', () => {
  beforeEach(() => {
    vi.resetModules()
    generateSinglePostForAccountMock.mockClear()
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

  it('404 quando a unidade não existe ou sem permissão', async () => {
    const { supabase } = createFakeSupabase({ units: [] })
    Object.assign(supabase, { auth: { getUser: async () => ({ data: { user: { id: 'auth-1' } } }) } })
    const { POST } = await loadRoute(supabase)

    const res = await POST(makeRequest({ unit_id: 'unit-inexistente' }))
    expect(res.status).toBe(404)
  })

  it('400 quando o Gestor de Conteúdo ainda não está ativo na unidade', async () => {
    const { supabase } = createFakeSupabase({ units: [{ id: 'unit-1' }], agent_configs: [] })
    Object.assign(supabase, { auth: { getUser: async () => ({ data: { user: { id: 'auth-1' } } }) } })
    const { POST } = await loadRoute(supabase)

    const res = await POST(makeRequest({ unit_id: 'unit-1' }))
    expect(res.status).toBe(400)
  })

  it('404 sem nenhuma conta conectada', async () => {
    const { supabase } = createFakeSupabase({
      units: [{ id: 'unit-1' }],
      agent_configs: [{ id: 'cfg-1', unit_id: 'unit-1', agent_type: 'content_specialist', is_active: true }],
      social_accounts: [],
    })
    Object.assign(supabase, { auth: { getUser: async () => ({ data: { user: { id: 'auth-1' } } }) } })
    const { POST } = await loadRoute(supabase)

    const res = await POST(makeRequest({ unit_id: 'unit-1' }))
    expect(res.status).toBe(404)
  })

  it('gera o post com sucesso, delegando pra generateSinglePostForAccount', async () => {
    const { supabase } = createFakeSupabase({
      units: [{ id: 'unit-1' }],
      agent_configs: [{ id: 'cfg-1', unit_id: 'unit-1', agent_type: 'content_specialist', is_active: true }],
      social_accounts: [{ id: 'acc-1', unit_id: 'unit-1', is_active: true, connection_status: 'connected' }],
    })
    Object.assign(supabase, { auth: { getUser: async () => ({ data: { user: { id: 'auth-1' } } }) } })
    const { POST } = await loadRoute(supabase)

    const res = await POST(makeRequest({ unit_id: 'unit-1' }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.post.id).toBe('post-1')
    expect(generateSinglePostForAccountMock).toHaveBeenCalledTimes(1)
  })

  it('502 quando a geração falha', async () => {
    generateSinglePostForAccountMock.mockResolvedValueOnce({ ok: false, error: 'OpenAI indisponível' })
    const { supabase } = createFakeSupabase({
      units: [{ id: 'unit-1' }],
      agent_configs: [{ id: 'cfg-1', unit_id: 'unit-1', agent_type: 'content_specialist', is_active: true }],
      social_accounts: [{ id: 'acc-1', unit_id: 'unit-1', is_active: true, connection_status: 'connected' }],
    })
    Object.assign(supabase, { auth: { getUser: async () => ({ data: { user: { id: 'auth-1' } } }) } })
    const { POST } = await loadRoute(supabase)

    const res = await POST(makeRequest({ unit_id: 'unit-1' }))
    expect(res.status).toBe(502)
  })
})
