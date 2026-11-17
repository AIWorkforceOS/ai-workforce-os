import { afterEach, describe, expect, it, vi } from 'vitest'

const createClient = vi.fn((..._args: unknown[]) => ({ mocked: true }))

vi.mock('@supabase/supabase-js', () => ({ createClient }))

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('createServiceClient', () => {
  it('desabilita cache nas leituras privilegiadas', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key')
    const fetchMock = vi.fn(async () => new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)

    const { createServiceClient } = await import('@/lib/supabase/service')
    createServiceClient()

    const options = createClient.mock.calls[0]?.[2] as {
      global: { fetch: typeof fetch }
    }
    await options.global.fetch('https://project.supabase.co/rest/v1/partner_api_keys', {
      headers: { authorization: 'Bearer secret' },
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://project.supabase.co/rest/v1/partner_api_keys',
      expect.objectContaining({ cache: 'no-store' }),
    )
  })
})
