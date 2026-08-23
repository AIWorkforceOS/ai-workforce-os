import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'

function makeRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/content/posting-days', { method: 'PATCH', body: JSON.stringify(body) })
}

async function loadRoute(supabase: unknown) {
  vi.doMock('@/lib/supabase/server', () => ({ createClient: async () => supabase }))
  return import('../route')
}

describe('PATCH /api/content/posting-days', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('401 sem sessão autenticada', async () => {
    const { supabase } = createFakeSupabase({})
    Object.assign(supabase, { auth: { getUser: async () => ({ data: { user: null } }) } })
    const { PATCH } = await loadRoute(supabase)

    const res = await PATCH(makeRequest({ unit_id: 'unit-1', dias_publicacao: [1, 3, 5] }))
    expect(res.status).toBe(401)
  })

  it('400 quando dias_publicacao tem valor fora de 1-7', async () => {
    const { supabase } = createFakeSupabase({})
    Object.assign(supabase, { auth: { getUser: async () => ({ data: { user: { id: 'auth-1' } } }) } })
    const { PATCH } = await loadRoute(supabase)

    const res = await PATCH(makeRequest({ unit_id: 'unit-1', dias_publicacao: [0, 8] }))
    expect(res.status).toBe(400)
  })

  it('404 quando não há Gestor de Conteúdo pra essa unidade (ou sem permissão)', async () => {
    const { supabase } = createFakeSupabase({ agent_configs: [] })
    Object.assign(supabase, { auth: { getUser: async () => ({ data: { user: { id: 'auth-1' } } }) } })
    const { PATCH } = await loadRoute(supabase)

    const res = await PATCH(makeRequest({ unit_id: 'unit-1', dias_publicacao: [1, 3, 5] }))
    expect(res.status).toBe(404)
  })

  it('salva os dias ordenados e sem duplicata, preservando o resto do business_profile', async () => {
    const { supabase, db } = createFakeSupabase({
      agent_configs: [
        {
          id: 'cfg-1',
          unit_id: 'unit-1',
          agent_type: 'content_specialist',
          business_profile: { pilares_conteudo: ['dicas'] },
        },
      ],
    })
    Object.assign(supabase, { auth: { getUser: async () => ({ data: { user: { id: 'auth-1' } } }) } })
    const { PATCH } = await loadRoute(supabase)

    const res = await PATCH(makeRequest({ unit_id: 'unit-1', dias_publicacao: [5, 1, 3, 1] }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.dias_publicacao).toEqual([1, 3, 5])
    const config = db.agent_configs?.[0] as Record<string, unknown>
    const profile = config.business_profile as Record<string, unknown>
    expect(profile.dias_publicacao).toEqual([1, 3, 5])
    expect(profile.pilares_conteudo).toEqual(['dicas'])
  })
})
