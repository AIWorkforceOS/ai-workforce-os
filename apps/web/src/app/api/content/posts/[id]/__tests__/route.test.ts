import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'

// Planejamento semanal (pedido do Vinicius, 2026-08-23): aprovar um post
// com scheduled_for no futuro NUNCA publica na hora — só marca 'approved'
// e espera o cron publicar no dia certo. Sem scheduled_for (fluxo avulso
// antigo) ou com scheduled_for de hoje/passado, publica na hora como
// sempre publicou.

function makePost(overrides: Record<string, unknown> = {}) {
  return {
    id: 'post-1',
    org_id: 'org-1',
    unit_id: 'unit-1',
    social_account_id: 'acc-1',
    platform: 'instagram',
    status: 'pending_approval',
    content_pillar: null,
    caption: 'legenda',
    image_prompt: null,
    image_url: 'https://cdn.example.com/img.png',
    reasoning: 'porque sim',
    mode: 'suggestion',
    scheduled_for: null,
    published_at: null,
    external_post_id: null,
    error_message: null,
    decided_by: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

function makeRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/content/posts/post-1', { method: 'PATCH', body: JSON.stringify(body) })
}

const publishContentPostMock = vi.fn(async () => ({ ok: true, externalPostId: 'ext-1' }))

async function loadRoute(supabase: unknown) {
  vi.doMock('@/lib/supabase/server', () => ({ createClient: async () => supabase }))
  vi.doMock('@/lib/supabase/service', () => ({ createServiceClient: () => supabase }))
  vi.doMock('@/lib/content/publisher', () => ({ publishContentPost: publishContentPostMock }))
  return import('../route')
}

describe('PATCH /api/content/posts/[id] — planejamento semanal x aprovação', () => {
  beforeEach(() => {
    vi.resetModules()
    publishContentPostMock.mockClear()
  })

  it('post sem scheduled_for (fluxo avulso antigo): aprovar publica na hora, como sempre', async () => {
    const { supabase } = createFakeSupabase({
      content_posts: [makePost({ scheduled_for: null })],
      social_accounts: [{ id: 'acc-1' }],
    })
    Object.assign(supabase, { auth: { getUser: async () => ({ data: { user: { email: 'dono@mawi.com' } } }) } })
    const { PATCH } = await loadRoute(supabase)

    const res = await PATCH(makeRequest({ action: 'approve' }), { params: Promise.resolve({ id: 'post-1' }) })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.published).toBe(true)
    expect(publishContentPostMock).toHaveBeenCalledTimes(1)
  })

  it('post com scheduled_for no futuro (planejamento semanal): aprovar só marca approved, NÃO publica agora', async () => {
    const futureDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString()
    const { supabase, db } = createFakeSupabase({
      content_posts: [makePost({ scheduled_for: futureDate })],
      social_accounts: [{ id: 'acc-1' }],
    })
    Object.assign(supabase, { auth: { getUser: async () => ({ data: { user: { email: 'dono@mawi.com' } } }) } })
    const { PATCH } = await loadRoute(supabase)

    const res = await PATCH(makeRequest({ action: 'approve' }), { params: Promise.resolve({ id: 'post-1' }) })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.post.status).toBe('approved')
    expect(json.published).toBe(false)
    expect(json.scheduled).toBe(true)
    expect(publishContentPostMock).not.toHaveBeenCalled()
    expect((db.content_posts?.[0] as Record<string, unknown>).status).toBe('approved')
  })

  it('post com scheduled_for de HOJE: aprovar publica na hora (não espera até amanhã)', async () => {
    const { supabase } = createFakeSupabase({
      content_posts: [makePost({ scheduled_for: new Date().toISOString() })],
      social_accounts: [{ id: 'acc-1' }],
    })
    Object.assign(supabase, { auth: { getUser: async () => ({ data: { user: { email: 'dono@mawi.com' } } }) } })
    const { PATCH } = await loadRoute(supabase)

    const res = await PATCH(makeRequest({ action: 'approve' }), { params: Promise.resolve({ id: 'post-1' }) })
    const json = await res.json()

    expect(json.published).toBe(true)
    expect(publishContentPostMock).toHaveBeenCalledTimes(1)
  })

  it('rejeitar um post agendado nunca publica, igual ao fluxo avulso', async () => {
    const futureDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString()
    const { supabase } = createFakeSupabase({
      content_posts: [makePost({ scheduled_for: futureDate })],
      social_accounts: [{ id: 'acc-1' }],
    })
    Object.assign(supabase, { auth: { getUser: async () => ({ data: { user: { email: 'dono@mawi.com' } } }) } })
    const { PATCH } = await loadRoute(supabase)

    const res = await PATCH(makeRequest({ action: 'reject' }), { params: Promise.resolve({ id: 'post-1' }) })
    const json = await res.json()

    expect(json.post.status).toBe('rejected')
    expect(publishContentPostMock).not.toHaveBeenCalled()
  })
})
