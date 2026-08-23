import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'

// Atualização manual do desempenho do Search Console (2026-08-23) — botão
// "Atualizar agora" no painel, pra não precisar esperar o ciclo semanal do
// cron pra ver o primeiro dado real depois de conectar.

const refreshAccessTokenMock = vi.fn(async () => ({ accessToken: 'access-novo', expiresInSeconds: 3600 }))
const fetchSearchConsolePerformanceMock = vi.fn(async () => ({
  periodStart: '2026-07-23',
  periodEnd: '2026-08-20',
  totalClicks: 120,
  totalImpressions: 3400,
  avgCtr: 0.035,
  avgPosition: 8.2,
  topQueries: [{ query: 'limpeza comercial phoenix', clicks: 40, impressions: 900, ctr: 0.044, position: 5.1 }],
}))

function makeAccount(overrides: Record<string, unknown> = {}) {
  return {
    id: 'gsc-1',
    org_id: 'org-1',
    unit_id: 'unit-1',
    site_url: 'https://mawi.com/',
    refresh_token: 'refresh-1',
    access_token: 'access-velho',
    token_expires_at: new Date().toISOString(),
    connection_status: 'connected',
    connection_error: null,
    connected_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

function makeRequest() {
  return new Request('http://localhost/api/seo/units/unit-1/search-console/refresh', { method: 'POST' })
}

async function loadRoute(supabase: unknown, envConfigured = true) {
  vi.doMock('@/lib/supabase/server', () => ({ createClient: async () => supabase }))
  vi.doMock('@/lib/supabase/service', () => ({ createServiceClient: () => supabase }))
  vi.doMock('@/lib/seo/search-console', () => ({ fetchSearchConsolePerformance: fetchSearchConsolePerformanceMock }))
  vi.doMock('@/lib/seo/search-console-oauth', () => ({
    refreshAccessToken: refreshAccessTokenMock,
    getGoogleSearchConsoleCredentials: () => (envConfigured ? { clientId: 'c', clientSecret: 's' } : null),
  }))
  return import('../route')
}

describe('POST /api/seo/units/[unitId]/search-console/refresh', () => {
  beforeEach(() => {
    vi.resetModules()
    refreshAccessTokenMock.mockClear()
    fetchSearchConsolePerformanceMock.mockClear()
  })
  afterEach(() => {
    vi.doUnmock('@/lib/seo/search-console')
    vi.doUnmock('@/lib/seo/search-console-oauth')
  })

  it('401 sem sessão autenticada', async () => {
    const { supabase } = createFakeSupabase({ units: [{ id: 'unit-1' }], seo_search_console_accounts: [makeAccount()] })
    Object.assign(supabase, { auth: { getUser: async () => ({ data: { user: null } }) } })
    const { POST } = await loadRoute(supabase)

    const res = await POST(makeRequest(), { params: Promise.resolve({ unitId: 'unit-1' }) })
    expect(res.status).toBe(401)
  })

  it('404 quando a unidade não existe/sem permissão', async () => {
    const { supabase } = createFakeSupabase({ units: [], seo_search_console_accounts: [] })
    Object.assign(supabase, { auth: { getUser: async () => ({ data: { user: { id: 'auth-1', email: 'a@a.com' } } }) } })
    const { POST } = await loadRoute(supabase)

    const res = await POST(makeRequest(), { params: Promise.resolve({ unitId: 'unit-1' }) })
    expect(res.status).toBe(404)
  })

  it('500 quando as credenciais do Google não estão configuradas', async () => {
    const { supabase } = createFakeSupabase({ units: [{ id: 'unit-1' }], seo_search_console_accounts: [makeAccount()] })
    Object.assign(supabase, { auth: { getUser: async () => ({ data: { user: { id: 'auth-1', email: 'a@a.com' } } }) } })
    const { POST } = await loadRoute(supabase, false)

    const res = await POST(makeRequest(), { params: Promise.resolve({ unitId: 'unit-1' }) })
    expect(res.status).toBe(500)
  })

  it('404 quando nenhuma conta do Search Console está conectada nesta unidade', async () => {
    const { supabase } = createFakeSupabase({ units: [{ id: 'unit-1' }], seo_search_console_accounts: [] })
    Object.assign(supabase, { auth: { getUser: async () => ({ data: { user: { id: 'auth-1', email: 'a@a.com' } } }) } })
    const { POST } = await loadRoute(supabase)

    const res = await POST(makeRequest(), { params: Promise.resolve({ unitId: 'unit-1' }) })
    expect(res.status).toBe(404)
  })

  it('busca o desempenho real, grava o snapshot e atualiza o token da conta', async () => {
    const { supabase, db } = createFakeSupabase({ units: [{ id: 'unit-1' }], seo_search_console_accounts: [makeAccount()] })
    Object.assign(supabase, { auth: { getUser: async () => ({ data: { user: { id: 'auth-1', email: 'a@a.com' } } }) } })
    const { POST } = await loadRoute(supabase)

    const res = await POST(makeRequest(), { params: Promise.resolve({ unitId: 'unit-1' }) })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.snapshot).toMatchObject({ total_clicks: 120, total_impressions: 3400 })

    const savedSnapshot = db.seo_search_console_snapshots?.[0] as Record<string, unknown>
    expect(savedSnapshot).toMatchObject({ unit_id: 'unit-1', total_clicks: 120 })

    const updatedAccount = db.seo_search_console_accounts?.[0] as Record<string, unknown>
    expect(updatedAccount).toMatchObject({ access_token: 'access-novo', connection_status: 'connected', connection_error: null })
  })

  it('502 e marca a conta com erro quando a busca falha (ex: token revogado)', async () => {
    fetchSearchConsolePerformanceMock.mockRejectedValueOnce(new Error('sem permissão nessa propriedade'))
    const { supabase, db } = createFakeSupabase({ units: [{ id: 'unit-1' }], seo_search_console_accounts: [makeAccount()] })
    Object.assign(supabase, { auth: { getUser: async () => ({ data: { user: { id: 'auth-1', email: 'a@a.com' } } }) } })
    const { POST } = await loadRoute(supabase)

    const res = await POST(makeRequest(), { params: Promise.resolve({ unitId: 'unit-1' }) })
    expect(res.status).toBe(502)
    const json = await res.json()
    expect(json.error).toContain('sem permissão')

    const updatedAccount = db.seo_search_console_accounts?.[0] as Record<string, unknown>
    expect(updatedAccount).toMatchObject({ connection_status: 'error', connection_error: 'sem permissão nessa propriedade' })
  })
})
