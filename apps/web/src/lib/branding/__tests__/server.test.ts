import { beforeEach, describe, expect, it, vi } from 'vitest'

let result: { data: unknown; error: unknown } = { data: null, error: null }
let throwOnCall = false
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: () => {
      if (throwOnCall) throw new Error('boom')
      const q: Record<string, unknown> = {}
      Object.assign(q, { select: () => q, eq: () => q, maybeSingle: async () => result })
      return q
    },
  }),
}))
vi.mock('@/lib/portal-360/data', () => ({ resolveClientTargetCustomer: async () => ({ orgId: 'org-mawi' }) }))
vi.mock('react', async (orig) => ({ ...(await orig<Record<string, unknown>>()), cache: <T,>(fn: T) => fn }))

import { brandingObjectPathFromUrl, getBrandLogoUrl, readCanManageBranding, readOrgLogoUrl } from '../server'

beforeEach(() => {
  result = { data: null, error: null }
  throwOnCall = false
})

describe('leituras da marca (sempre toleram falha)', () => {
  it('devolve a logo https da empresa; qualquer problema vira "sem logo própria" (logo do Alizo)', async () => {
    result = { data: { brand_logo_url: 'https://x.supabase.co/storage/v1/object/public/org-branding/o/logo-1.png' }, error: null }
    expect(await readOrgLogoUrl('o')).toMatch(/^https:\/\//)
    result = { data: { brand_logo_url: 'http://inseguro/logo.png' }, error: null }
    expect(await readOrgLogoUrl('o')).toBeNull()
    result = { data: { brand_logo_url: 'javascript:alert(1)' }, error: null }
    expect(await readOrgLogoUrl('o')).toBeNull()
    result = { data: null, error: { message: 'column organizations.brand_logo_url does not exist' } } // migration ainda não aplicada
    expect(await readOrgLogoUrl('o')).toBeNull()
    throwOnCall = true
    expect(await readOrgLogoUrl('o')).toBeNull()
    expect(await readOrgLogoUrl(null)).toBeNull()
  })
  it('cliente externo (sem empresa própria) vê a logo da empresa que o atende', async () => {
    result = { data: { brand_logo_url: 'https://x/logo.png' }, error: null }
    const user = { id: 'u', email: 'c@x', name: null, role: 'client', orgId: null, orgName: null, isSuperAdmin: false, unitId: null, employeeId: null, clientCompany: '360 Service Provider' } as never
    expect(await getBrandLogoUrl(user)).toBe('https://x/logo.png')
  })
  it('permissão: super admin sempre; admin só se liberado; coluna ausente = não liberado; outros nunca', async () => {
    expect(await readCanManageBranding({ id: 'a', isSuperAdmin: true, role: 'super_admin' })).toBe(true)
    result = { data: { can_manage_branding: true }, error: null }
    expect(await readCanManageBranding({ id: 'a', isSuperAdmin: false, role: 'admin' })).toBe(true)
    expect(await readCanManageBranding({ id: 'a', isSuperAdmin: false, role: 'employee' })).toBe(false)
    result = { data: { can_manage_branding: false }, error: null }
    expect(await readCanManageBranding({ id: 'a', isSuperAdmin: false, role: 'admin' })).toBe(false)
    result = { data: null, error: { message: 'column does not exist' } }
    expect(await readCanManageBranding({ id: 'a', isSuperAdmin: false, role: 'admin' })).toBe(false)
  })
  it('extrai o caminho do objeto só de URLs do nosso bucket', () => {
    expect(brandingObjectPathFromUrl('https://p.supabase.co/storage/v1/object/public/org-branding/org-1/logo-abc.png')).toBe('org-1/logo-abc.png')
    expect(brandingObjectPathFromUrl('https://outro.com/logo.png')).toBeNull()
    expect(brandingObjectPathFromUrl(null)).toBeNull()
  })
})
