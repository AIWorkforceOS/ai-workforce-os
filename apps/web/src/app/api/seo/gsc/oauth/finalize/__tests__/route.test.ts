import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'

// Login com Google Search Console do funcionário de SEO (2026-08-23) —
// passo final de escolha de propriedade, só chamado quando a conta Google
// tem mais de uma verificada (ver oauth/callback/route.ts). Mesmo padrão
// de content/accounts/oauth/finalize.

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sess-1',
    org_id: 'org-1',
    unit_id: 'unit-1',
    site_urls: ['https://mawi.com/', 'sc-domain:mawi.com'],
    refresh_token: 'refresh-1',
    access_token: 'access-1',
    expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    created_at: new Date().toISOString(),
    ...overrides,
  }
}

function makeRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/seo/gsc/oauth/finalize', { method: 'POST', body: JSON.stringify(body) })
}

async function loadRoute(supabase: unknown) {
  vi.doMock('@/lib/supabase/server', () => ({ createClient: async () => supabase }))
  return import('../route')
}

describe('POST /api/seo/gsc/oauth/finalize', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('401 sem sessão autenticada', async () => {
    const { supabase } = createFakeSupabase({ seo_gsc_oauth_sessions: [makeSession()] })
    Object.assign(supabase, { auth: { getUser: async () => ({ data: { user: null } }) } })
    const { POST } = await loadRoute(supabase)

    const res = await POST(makeRequest({ oauth_session_id: 'sess-1', site_url: 'https://mawi.com/' }))
    expect(res.status).toBe(401)
  })

  it('400 faltando campos obrigatórios', async () => {
    const { supabase } = createFakeSupabase({ seo_gsc_oauth_sessions: [makeSession()] })
    Object.assign(supabase, { auth: { getUser: async () => ({ data: { user: { id: 'auth-1' } } }) } })
    const { POST } = await loadRoute(supabase)

    const res = await POST(makeRequest({ oauth_session_id: 'sess-1' }))
    expect(res.status).toBe(400)
  })

  it('404 quando a sessão não existe', async () => {
    const { supabase } = createFakeSupabase({ seo_gsc_oauth_sessions: [] })
    Object.assign(supabase, { auth: { getUser: async () => ({ data: { user: { id: 'auth-1' } } }) } })
    const { POST } = await loadRoute(supabase)

    const res = await POST(makeRequest({ oauth_session_id: 'sess-inexistente', site_url: 'https://mawi.com/' }))
    expect(res.status).toBe(404)
  })

  it('410 quando a sessão já expirou — e apaga a sessão', async () => {
    const { supabase, db } = createFakeSupabase({ seo_gsc_oauth_sessions: [makeSession({ expires_at: new Date(Date.now() - 60_000).toISOString() })] })
    Object.assign(supabase, { auth: { getUser: async () => ({ data: { user: { id: 'auth-1' } } }) } })
    const { POST } = await loadRoute(supabase)

    const res = await POST(makeRequest({ oauth_session_id: 'sess-1', site_url: 'https://mawi.com/' }))
    expect(res.status).toBe(410)
    expect(db.seo_gsc_oauth_sessions).toHaveLength(0)
  })

  it('404 quando a propriedade escolhida não está na lista da sessão', async () => {
    const { supabase } = createFakeSupabase({ seo_gsc_oauth_sessions: [makeSession()] })
    Object.assign(supabase, { auth: { getUser: async () => ({ data: { user: { id: 'auth-1' } } }) } })
    const { POST } = await loadRoute(supabase)

    const res = await POST(makeRequest({ oauth_session_id: 'sess-1', site_url: 'https://nao-esta-na-lista.com/' }))
    expect(res.status).toBe(404)
  })

  it('conecta a propriedade escolhida em seo_search_console_accounts e apaga a sessão', async () => {
    const { supabase, db } = createFakeSupabase({ seo_gsc_oauth_sessions: [makeSession()] })
    Object.assign(supabase, { auth: { getUser: async () => ({ data: { user: { id: 'auth-1' } } }) } })
    const { POST } = await loadRoute(supabase)

    const res = await POST(makeRequest({ oauth_session_id: 'sess-1', site_url: 'sc-domain:mawi.com' }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.label).toBe('sc-domain:mawi.com')

    const saved = db.seo_search_console_accounts?.[0] as Record<string, unknown>
    expect(saved).toMatchObject({
      site_url: 'sc-domain:mawi.com',
      refresh_token: 'refresh-1',
      access_token: 'access-1',
      connection_status: 'connected',
    })
    expect(db.seo_gsc_oauth_sessions).toHaveLength(0)
    expect(db.system_events?.[0]).toMatchObject({ event_type: 'seo_gsc_connected', unit_id: 'unit-1' })
  })
})
