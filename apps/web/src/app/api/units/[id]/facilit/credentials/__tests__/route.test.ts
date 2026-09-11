import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'

function authedSupabase(overrides: Parameters<typeof createFakeSupabase>[0] = {}) {
  const { supabase, db } = createFakeSupabase(overrides)
  Object.assign(supabase, { auth: { getUser: async () => ({ data: { user: { id: 'auth-1', email: 'dono@mawipro.com' } } }) } })
  return { supabase, db }
}

async function loadRoute(supabase: unknown) {
  vi.doMock('@/lib/supabase/server', () => ({ createClient: async () => supabase }))
  return import('../route')
}

describe('GET /api/units/[id]/facilit/credentials', () => {
  beforeEach(() => vi.resetModules())

  it('401 sem sessão', async () => {
    const { supabase } = createFakeSupabase({})
    Object.assign(supabase, { auth: { getUser: async () => ({ data: { user: null } }) } })
    const { GET } = await loadRoute(supabase)

    const res = await GET(new Request('http://localhost'), { params: Promise.resolve({ id: 'unit-1' }) })
    expect(res.status).toBe(401)
  })

  it('devolve client_code/username/status da credencial cadastrada', async () => {
    // Nota: a proteção real contra vazar a senha é a lista explícita de
    // colunas no .select() da rota — o fake-supabase não simula projeção
    // de colunas (sempre devolve a linha inteira), então esse teste não
    // consegue verificar a ausência da senha aqui; só confirma os campos
    // esperados chegam.
    const { supabase } = authedSupabase({
      facilit_credentials: [
        { id: 'cred-1', unit_id: 'unit-1', org_id: 'org-1', client_code: 'CC1', username: 'user1', password: 'segredo', is_active: true },
      ],
    })
    const { GET } = await loadRoute(supabase)

    const res = await GET(new Request('http://localhost'), { params: Promise.resolve({ id: 'unit-1' }) })
    const body = await res.json()

    expect(body.credential).toMatchObject({ client_code: 'CC1', username: 'user1' })
  })

  it('sem credencial cadastrada devolve null', async () => {
    const { supabase } = authedSupabase({})
    const { GET } = await loadRoute(supabase)

    const res = await GET(new Request('http://localhost'), { params: Promise.resolve({ id: 'unit-1' }) })
    const body = await res.json()
    expect(body.credential).toBeNull()
  })
})

describe('POST /api/units/[id]/facilit/credentials', () => {
  beforeEach(() => vi.resetModules())

  function makeRequest(body: Record<string, unknown>) {
    return new Request('http://localhost', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  }

  it('401 sem sessão', async () => {
    const { supabase } = createFakeSupabase({})
    Object.assign(supabase, { auth: { getUser: async () => ({ data: { user: null } }) } })
    const { POST } = await loadRoute(supabase)

    const res = await POST(makeRequest({ clientCode: 'CC1', username: 'u', password: 'p' }), { params: Promise.resolve({ id: 'unit-1' }) })
    expect(res.status).toBe(401)
  })

  it('400 quando falta algum campo', async () => {
    const { supabase } = authedSupabase({ units: [{ id: 'unit-1', org_id: 'org-1' }] })
    const { POST } = await loadRoute(supabase)

    const res = await POST(makeRequest({ clientCode: '', username: 'u', password: 'p' }), { params: Promise.resolve({ id: 'unit-1' }) })
    expect(res.status).toBe(400)
  })

  it('salva a credencial nova', async () => {
    const { supabase, db } = authedSupabase({ units: [{ id: 'unit-1', org_id: 'org-1' }] })
    const { POST } = await loadRoute(supabase)

    const res = await POST(makeRequest({ clientCode: 'CC1', username: 'user1', password: 'secret' }), { params: Promise.resolve({ id: 'unit-1' }) })
    expect(res.status).toBe(200)
    expect(db.facilit_credentials?.[0]).toMatchObject({ client_code: 'CC1', username: 'user1', password: 'secret', unit_id: 'unit-1' })
  })

  it('trocar credenciais atualiza a linha existente (upsert por unit_id)', async () => {
    const { supabase, db } = authedSupabase({
      units: [{ id: 'unit-1', org_id: 'org-1' }],
      facilit_credentials: [{ id: 'cred-1', unit_id: 'unit-1', org_id: 'org-1', client_code: 'OLD', username: 'old', password: 'old-pass', is_active: true }],
    })
    const { POST } = await loadRoute(supabase)

    await POST(makeRequest({ clientCode: 'NEW', username: 'new', password: 'new-pass' }), { params: Promise.resolve({ id: 'unit-1' }) })

    expect(db.facilit_credentials).toHaveLength(1)
    expect(db.facilit_credentials?.[0]).toMatchObject({ client_code: 'NEW', username: 'new', password: 'new-pass' })
  })
})
