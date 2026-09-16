import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'

process.env.CRON_SECRET = 'test-secret'

// Cron diário de sync Facil-IT (Mawi Pro, 2026-09-10) — cobre "todos os
// dias o sistema irá verificar de forma automática novas ordens".

const syncFacilitOrdersForUnit = vi.fn()

function makeCredential(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cred-1',
    org_id: 'org-1',
    unit_id: 'unit-1',
    client_code: 'CC1',
    username: 'user1',
    password: 'secret',
    is_active: true,
    ...overrides,
  }
}

function makeUnitRow(overrides: Record<string, unknown> = {}) {
  return { id: 'unit-1', org_id: 'org-1', name: 'Mawi Pro — Principal', timezone: 'America/Phoenix', ...overrides }
}

async function loadRoute(supabase: unknown) {
  vi.doMock('@/lib/supabase/service', () => ({ createServiceClient: () => supabase }))
  vi.doMock('@/lib/facilit-sync', () => ({ syncFacilitOrdersForUnit }))
  return import('../route')
}

function makeRequest() {
  return new Request('http://localhost/api/cron/facilit-sync', { headers: { authorization: 'Bearer test-secret' } })
}

describe('GET /api/cron/facilit-sync', () => {
  beforeEach(() => {
    vi.resetModules()
    syncFacilitOrdersForUnit.mockReset()
  })

  afterEach(() => {
    vi.doUnmock('@/lib/facilit-sync')
  })

  it('401 sem o header de autorização correto', async () => {
    const { supabase } = createFakeSupabase({})
    const { GET } = await loadRoute(supabase)
    const res = await GET(new Request('http://localhost/api/cron/facilit-sync'))
    expect(res.status).toBe(401)
  })

  it('sincroniza todas as unidades com credencial ativa', async () => {
    syncFacilitOrdersForUnit.mockResolvedValue({ imported: 3, error: null })
    const { supabase } = createFakeSupabase({
      facilit_credentials: [makeCredential()],
      units: [makeUnitRow()],
      organizations: [{ id: 'org-1', facilit_integration_enabled: true }],
    })
    const { GET } = await loadRoute(supabase)

    const res = await GET(makeRequest())
    const body = await res.json()

    expect(body).toEqual({ ok: true, synced: 1, imported: 3, errors: 0 })
    expect(syncFacilitOrdersForUnit).toHaveBeenCalledTimes(1)
  })

  it('pula unidades de organizações sem a integração habilitada (defesa em profundidade — a criação da credencial já é bloqueada)', async () => {
    const { supabase } = createFakeSupabase({
      facilit_credentials: [makeCredential()],
      units: [makeUnitRow()],
      organizations: [{ id: 'org-1', facilit_integration_enabled: false }],
    })
    const { GET } = await loadRoute(supabase)

    const res = await GET(makeRequest())
    const body = await res.json()

    expect(body).toEqual({ ok: true, synced: 0, imported: 0, errors: 0 })
    expect(syncFacilitOrdersForUnit).not.toHaveBeenCalled()
  })

  it('ignora credenciais inativas', async () => {
    const { supabase } = createFakeSupabase({
      facilit_credentials: [makeCredential({ is_active: false })],
      units: [makeUnitRow()],
    })
    const { GET } = await loadRoute(supabase)

    const res = await GET(makeRequest())
    const body = await res.json()

    expect(body).toEqual({ ok: true, synced: 0, imported: 0, errors: 0 })
    expect(syncFacilitOrdersForUnit).not.toHaveBeenCalled()
  })

  it('erro numa unidade conta como erro mas não derruba o cron inteiro', async () => {
    syncFacilitOrdersForUnit.mockResolvedValue({ imported: 0, error: 'Login na Facil-IT falhou' })
    const { supabase } = createFakeSupabase({
      facilit_credentials: [makeCredential()],
      units: [makeUnitRow()],
      organizations: [{ id: 'org-1', facilit_integration_enabled: true }],
    })
    const { GET } = await loadRoute(supabase)

    const res = await GET(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ ok: true, synced: 1, imported: 0, errors: 1 })
  })
})
