import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'

const removeSolidBackgroundMock = vi.fn(async (buf: Buffer) => buf)
const extractPaletteFromLogoMock = vi.fn(async () => ({ primary: '#FF0000', secondary: '#0000FF' }))

function fakeStorage(uploadOk = true) {
  return {
    from: () => ({
      upload: vi.fn(async () => (uploadOk ? { error: null } : { error: { message: 'boom' } })),
      getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn.example.com/${path}` } }),
    }),
  }
}

function makeFormRequest(fields: Record<string, string | Blob>) {
  const form = new FormData()
  for (const [key, value] of Object.entries(fields)) form.append(key, value)
  return new Request('http://localhost/api/content/brand-kit/logo', { method: 'POST', body: form })
}

async function loadRoute(supabase: unknown, serviceClient: unknown = supabase) {
  vi.doMock('@/lib/supabase/server', () => ({ createClient: async () => supabase }))
  vi.doMock('@/lib/supabase/service', () => ({ createServiceClient: () => serviceClient }))
  vi.doMock('@/lib/content/logo-processing', () => ({
    removeSolidBackground: removeSolidBackgroundMock,
    extractPaletteFromLogo: extractPaletteFromLogoMock,
  }))
  return import('../route')
}

describe('POST /api/content/brand-kit/logo', () => {
  beforeEach(() => {
    vi.resetModules()
    removeSolidBackgroundMock.mockClear()
    extractPaletteFromLogoMock.mockClear()
  })

  it('401 sem sessão autenticada', async () => {
    const { supabase } = createFakeSupabase({})
    Object.assign(supabase, { auth: { getUser: async () => ({ data: { user: null } }) } })
    const { POST } = await loadRoute(supabase)

    const res = await POST(makeFormRequest({ unit_id: 'unit-1', file: new Blob(['x'], { type: 'image/png' }) }))
    expect(res.status).toBe(401)
  })

  it('400 sem arquivo', async () => {
    const { supabase } = createFakeSupabase({})
    Object.assign(supabase, { auth: { getUser: async () => ({ data: { user: { id: 'auth-1' } } }) } })
    const { POST } = await loadRoute(supabase)

    const res = await POST(makeFormRequest({ unit_id: 'unit-1' }))
    expect(res.status).toBe(400)
  })

  it('404 quando a unidade não existe ou sem permissão', async () => {
    const { supabase } = createFakeSupabase({ units: [] })
    Object.assign(supabase, { auth: { getUser: async () => ({ data: { user: { id: 'auth-1' } } }) } })
    const { POST } = await loadRoute(supabase)

    const res = await POST(makeFormRequest({ unit_id: 'unit-inexistente', file: new Blob(['x'], { type: 'image/png' }) }))
    expect(res.status).toBe(404)
  })

  it('processa (remove fundo + extrai paleta) e devolve logo_url + cores', async () => {
    const { supabase } = createFakeSupabase({ units: [{ id: 'unit-1' }] })
    Object.assign(supabase, { auth: { getUser: async () => ({ data: { user: { id: 'auth-1' } } }) }, storage: fakeStorage() })
    const { POST } = await loadRoute(supabase)

    const res = await POST(makeFormRequest({ unit_id: 'unit-1', file: new Blob(['fake-png-bytes'], { type: 'image/png' }) }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.primary_color).toBe('#FF0000')
    expect(json.secondary_color).toBe('#0000FF')
    expect(json.logo_url).toContain('unit-1/brand/logo-')
    expect(removeSolidBackgroundMock).toHaveBeenCalledTimes(1)
    expect(extractPaletteFromLogoMock).toHaveBeenCalledTimes(1)
  })

  it('500 quando o upload pro Storage falha', async () => {
    const { supabase } = createFakeSupabase({ units: [{ id: 'unit-1' }] })
    Object.assign(supabase, { auth: { getUser: async () => ({ data: { user: { id: 'auth-1' } } }) }, storage: fakeStorage(false) })
    const { POST } = await loadRoute(supabase)

    const res = await POST(makeFormRequest({ unit_id: 'unit-1', file: new Blob(['x'], { type: 'image/png' }) }))
    expect(res.status).toBe(500)
  })

  it('422 quando o processamento da imagem falha', async () => {
    removeSolidBackgroundMock.mockRejectedValueOnce(new Error('imagem inválida'))
    const { supabase } = createFakeSupabase({ units: [{ id: 'unit-1' }] })
    Object.assign(supabase, { auth: { getUser: async () => ({ data: { user: { id: 'auth-1' } } }) }, storage: fakeStorage() })
    const { POST } = await loadRoute(supabase)

    const res = await POST(makeFormRequest({ unit_id: 'unit-1', file: new Blob(['x'], { type: 'image/png' }) }))
    expect(res.status).toBe(422)
  })
})
