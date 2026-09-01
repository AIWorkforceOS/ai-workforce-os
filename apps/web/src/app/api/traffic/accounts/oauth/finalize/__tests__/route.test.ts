import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'

// Login com Facebook do Tráfego Pago (pedido do Vinicius, 2026-08-28) —
// passo final de escolha de conta de anúncio, só chamado quando o cliente
// administra mais de uma (ver oauth/callback/route.ts). Espelha
// api/content/accounts/oauth/finalize/__tests__/route.test.ts, com a
// diferença de que o token fica uma vez só na sessão (não por conta).

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sess-1',
    org_id: 'org-1',
    unit_id: 'unit-1',
    access_token: 'shared-user-token',
    accounts: [
      { id: 'act_111', name: 'Padaria da Maria', currency: 'BRL', account_status: 1 },
      { id: 'act_222', name: 'Padaria da Maria (loja 2)', currency: 'BRL', account_status: 1 },
    ],
    expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    created_at: new Date().toISOString(),
    ...overrides,
  }
}

function makeRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/traffic/accounts/oauth/finalize', { method: 'POST', body: JSON.stringify(body) })
}

async function loadRoute(supabase: unknown) {
  vi.doMock('@/lib/supabase/server', () => ({ createClient: async () => supabase }))
  return import('../route')
}

describe('POST /api/traffic/accounts/oauth/finalize', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('401 sem sessão autenticada', async () => {
    const { supabase } = createFakeSupabase({ traffic_oauth_sessions: [makeSession()] })
    Object.assign(supabase, { auth: { getUser: async () => ({ data: { user: null } }) } })
    const { POST } = await loadRoute(supabase)

    const res = await POST(makeRequest({ oauth_session_id: 'sess-1', account_id: 'act_111' }))
    expect(res.status).toBe(401)
  })

  it('400 faltando campos obrigatórios', async () => {
    const { supabase } = createFakeSupabase({ traffic_oauth_sessions: [makeSession()] })
    Object.assign(supabase, { auth: { getUser: async () => ({ data: { user: { id: 'auth-1' } } }) } })
    const { POST } = await loadRoute(supabase)

    const res = await POST(makeRequest({ oauth_session_id: 'sess-1' }))
    expect(res.status).toBe(400)
  })

  it('404 quando a sessão não existe (expirada da tabela, ou sem permissão via RLS)', async () => {
    const { supabase } = createFakeSupabase({ traffic_oauth_sessions: [] })
    Object.assign(supabase, { auth: { getUser: async () => ({ data: { user: { id: 'auth-1' } } }) } })
    const { POST } = await loadRoute(supabase)

    const res = await POST(makeRequest({ oauth_session_id: 'sess-inexistente', account_id: 'act_111' }))
    expect(res.status).toBe(404)
  })

  it('410 quando a sessão já expirou (expires_at no passado) — e apaga a sessão', async () => {
    const { supabase, db } = createFakeSupabase({
      traffic_oauth_sessions: [makeSession({ expires_at: new Date(Date.now() - 60_000).toISOString() })],
    })
    Object.assign(supabase, { auth: { getUser: async () => ({ data: { user: { id: 'auth-1' } } }) } })
    const { POST } = await loadRoute(supabase)

    const res = await POST(makeRequest({ oauth_session_id: 'sess-1', account_id: 'act_111' }))
    expect(res.status).toBe(410)
    expect(db.traffic_oauth_sessions).toHaveLength(0)
  })

  it('404 quando a conta escolhida não está na lista da sessão', async () => {
    const { supabase } = createFakeSupabase({ traffic_oauth_sessions: [makeSession()] })
    Object.assign(supabase, { auth: { getUser: async () => ({ data: { user: { id: 'auth-1' } } }) } })
    const { POST } = await loadRoute(supabase)

    const res = await POST(makeRequest({ oauth_session_id: 'sess-1', account_id: 'act_nao_existe' }))
    expect(res.status).toBe(404)
  })

  it('conecta a conta escolhida em ad_accounts com o token compartilhado da sessão, e apaga a sessão', async () => {
    const { supabase, db } = createFakeSupabase({ traffic_oauth_sessions: [makeSession()] })
    Object.assign(supabase, { auth: { getUser: async () => ({ data: { user: { id: 'auth-1' } } }) } })
    const { POST } = await loadRoute(supabase)

    const res = await POST(makeRequest({ oauth_session_id: 'sess-1', account_id: 'act_222' }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.label).toBe('Padaria da Maria (loja 2)')

    const saved = db.ad_accounts?.[0] as Record<string, unknown>
    expect(saved).toMatchObject({
      platform: 'meta',
      external_account_id: 'act_222',
      name: 'Padaria da Maria (loja 2)',
      currency: 'BRL',
      access_token: 'shared-user-token',
      connection_status: 'connected',
    })
    expect(db.traffic_oauth_sessions).toHaveLength(0)
    expect(db.system_events?.[0]).toMatchObject({ event_type: 'traffic_oauth_connected', unit_id: 'unit-1' })
  })
})
