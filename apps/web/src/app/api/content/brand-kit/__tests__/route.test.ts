import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'

function makeRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/content/brand-kit', { method: 'PATCH', body: JSON.stringify(body) })
}

async function loadRoute(supabase: unknown, serviceClient: unknown = supabase) {
  vi.doMock('@/lib/supabase/server', () => ({ createClient: async () => supabase }))
  vi.doMock('@/lib/supabase/service', () => ({ createServiceClient: () => serviceClient }))
  return import('../route')
}

describe('PATCH /api/content/brand-kit', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('401 sem sessão autenticada', async () => {
    const { supabase } = createFakeSupabase({})
    Object.assign(supabase, { auth: { getUser: async () => ({ data: { user: null } }) } })
    const { PATCH } = await loadRoute(supabase)

    const res = await PATCH(makeRequest({ unit_id: 'unit-1', primary_color: '#1E40AF' }))
    expect(res.status).toBe(401)
  })

  it('400 sem unit_id', async () => {
    const { supabase } = createFakeSupabase({})
    Object.assign(supabase, { auth: { getUser: async () => ({ data: { user: { id: 'auth-1' } } }) } })
    const { PATCH } = await loadRoute(supabase)

    const res = await PATCH(makeRequest({ primary_color: '#1E40AF' }))
    expect(res.status).toBe(400)
  })

  it('400 cor fora do formato hex', async () => {
    const { supabase } = createFakeSupabase({ units: [{ id: 'unit-1', org_id: 'org-1' }] })
    Object.assign(supabase, { auth: { getUser: async () => ({ data: { user: { id: 'auth-1' } } }) } })
    const { PATCH } = await loadRoute(supabase)

    const res = await PATCH(makeRequest({ unit_id: 'unit-1', primary_color: 'azul' }))
    expect(res.status).toBe(400)
  })

  it('404 quando a unidade não existe ou o usuário não tem acesso (RLS)', async () => {
    const { supabase } = createFakeSupabase({ units: [] })
    Object.assign(supabase, { auth: { getUser: async () => ({ data: { user: { id: 'auth-1' } } }) } })
    const { PATCH } = await loadRoute(supabase)

    const res = await PATCH(makeRequest({ unit_id: 'unit-inexistente', primary_color: '#1E40AF' }))
    expect(res.status).toBe(404)
  })

  it('salva logo + cores, preservando outros campos já existentes em business_profile', async () => {
    const { supabase, db } = createFakeSupabase({
      units: [{ id: 'unit-1', org_id: 'org-1' }],
      organizations: [{ id: 'org-1', business_profile: { descricao_curta: 'Empresa de limpeza.', brand_kit: { logo_url: 'https://old.png' } } }],
    })
    Object.assign(supabase, { auth: { getUser: async () => ({ data: { user: { id: 'auth-1' } } }) } })
    const { PATCH } = await loadRoute(supabase)

    const res = await PATCH(
      makeRequest({ unit_id: 'unit-1', logo_url: 'https://cdn.example.com/logo.png', primary_color: '#1E40AF', secondary_color: '#10B981' }),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.brand_kit).toEqual({ logo_url: 'https://cdn.example.com/logo.png', primary_color: '#1E40AF', secondary_color: '#10B981' })

    const org = db.organizations?.[0] as Record<string, unknown>
    const profile = org.business_profile as Record<string, unknown>
    expect(profile.descricao_curta).toBe('Empresa de limpeza.') // não apagou o resto da ficha
    expect(profile.brand_kit).toEqual({ logo_url: 'https://cdn.example.com/logo.png', primary_color: '#1E40AF', secondary_color: '#10B981' })
  })

  it('permite remover só o logo (logo_url null) mantendo as cores', async () => {
    const { supabase, db } = createFakeSupabase({
      units: [{ id: 'unit-1', org_id: 'org-1' }],
      organizations: [{ id: 'org-1', business_profile: { brand_kit: { logo_url: 'https://old.png', primary_color: '#1E40AF' } } }],
    })
    Object.assign(supabase, { auth: { getUser: async () => ({ data: { user: { id: 'auth-1' } } }) } })
    const { PATCH } = await loadRoute(supabase)

    const res = await PATCH(makeRequest({ unit_id: 'unit-1', logo_url: null }))
    expect(res.status).toBe(200)
    const org = db.organizations?.[0] as Record<string, unknown>
    const brandKit = (org.business_profile as Record<string, unknown>).brand_kit as Record<string, unknown>
    expect(brandKit.logo_url).toBeNull()
    expect(brandKit.primary_color).toBe('#1E40AF')
  })
})
