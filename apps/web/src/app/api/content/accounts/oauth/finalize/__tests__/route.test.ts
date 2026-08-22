import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'

// Login com Facebook do Gestor de Conteúdo (Fase integrações reais,
// 2026-08-22) — passo final de escolha de Página, só chamado quando o
// cliente administra mais de uma (ver oauth/callback/route.ts).

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sess-1',
    org_id: 'org-1',
    unit_id: 'unit-1',
    pages: [
      { id: 'page-1', name: 'Padaria da Maria', access_token: 'tok-1', instagram_business_account_id: null, instagram_username: null },
      { id: 'page-2', name: 'Padaria da Maria (loja 2)', access_token: 'tok-2', instagram_business_account_id: 'ig-2', instagram_username: 'padaria2' },
    ],
    expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    created_at: new Date().toISOString(),
    ...overrides,
  }
}

function makeRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/content/accounts/oauth/finalize', { method: 'POST', body: JSON.stringify(body) })
}

async function loadRoute(supabase: unknown) {
  vi.doMock('@/lib/supabase/server', () => ({ createClient: async () => supabase }))
  return import('../route')
}

describe('POST /api/content/accounts/oauth/finalize', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('401 sem sessão autenticada', async () => {
    const { supabase } = createFakeSupabase({ content_oauth_sessions: [makeSession()] })
    Object.assign(supabase, { auth: { getUser: async () => ({ data: { user: null } }) } })
    const { POST } = await loadRoute(supabase)

    const res = await POST(makeRequest({ oauth_session_id: 'sess-1', page_id: 'page-1' }))
    expect(res.status).toBe(401)
  })

  it('400 faltando campos obrigatórios', async () => {
    const { supabase } = createFakeSupabase({ content_oauth_sessions: [makeSession()] })
    Object.assign(supabase, { auth: { getUser: async () => ({ data: { user: { id: 'auth-1' } } }) } })
    const { POST } = await loadRoute(supabase)

    const res = await POST(makeRequest({ oauth_session_id: 'sess-1' }))
    expect(res.status).toBe(400)
  })

  it('404 quando a sessão não existe (expirada da tabela, ou sem permissão via RLS)', async () => {
    const { supabase } = createFakeSupabase({ content_oauth_sessions: [] })
    Object.assign(supabase, { auth: { getUser: async () => ({ data: { user: { id: 'auth-1' } } }) } })
    const { POST } = await loadRoute(supabase)

    const res = await POST(makeRequest({ oauth_session_id: 'sess-inexistente', page_id: 'page-1' }))
    expect(res.status).toBe(404)
  })

  it('410 quando a sessão já expirou (expires_at no passado) — e apaga a sessão', async () => {
    const { supabase, db } = createFakeSupabase({ content_oauth_sessions: [makeSession({ expires_at: new Date(Date.now() - 60_000).toISOString() })] })
    Object.assign(supabase, { auth: { getUser: async () => ({ data: { user: { id: 'auth-1' } } }) } })
    const { POST } = await loadRoute(supabase)

    const res = await POST(makeRequest({ oauth_session_id: 'sess-1', page_id: 'page-1' }))
    expect(res.status).toBe(410)
    expect(db.content_oauth_sessions).toHaveLength(0)
  })

  it('404 quando a Página escolhida não está na lista da sessão', async () => {
    const { supabase } = createFakeSupabase({ content_oauth_sessions: [makeSession()] })
    Object.assign(supabase, { auth: { getUser: async () => ({ data: { user: { id: 'auth-1' } } }) } })
    const { POST } = await loadRoute(supabase)

    const res = await POST(makeRequest({ oauth_session_id: 'sess-1', page_id: 'page-nao-existe' }))
    expect(res.status).toBe(404)
  })

  it('conecta a Página escolhida em social_accounts e apaga a sessão', async () => {
    const { supabase, db } = createFakeSupabase({ content_oauth_sessions: [makeSession()] })
    Object.assign(supabase, { auth: { getUser: async () => ({ data: { user: { id: 'auth-1' } } }) } })
    const { POST } = await loadRoute(supabase)

    const res = await POST(makeRequest({ oauth_session_id: 'sess-1', page_id: 'page-2' }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.label).toBe('Padaria da Maria (loja 2)')

    const saved = db.social_accounts?.[0] as Record<string, unknown>
    expect(saved).toMatchObject({
      page_id: 'page-2',
      page_name: 'Padaria da Maria (loja 2)',
      page_access_token: 'tok-2',
      instagram_business_account_id: 'ig-2',
      instagram_username: 'padaria2',
      connection_status: 'connected',
    })
    expect(db.content_oauth_sessions).toHaveLength(0)
    expect(db.system_events?.[0]).toMatchObject({ event_type: 'content_oauth_connected', unit_id: 'unit-1' })
  })
})
