import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'

function makeRequest(pendingId: string | null) {
  const url = pendingId ? `http://localhost/api/checkout/status?pending=${pendingId}` : 'http://localhost/api/checkout/status'
  return new Request(url)
}

describe('GET /api/checkout/status', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('sem ?pending, devolve 400', async () => {
    const { supabase } = createFakeSupabase({})
    vi.doMock('@/lib/supabase/service', () => ({ createServiceClient: () => supabase }))

    const { GET } = await import('../route')
    const response = await GET(makeRequest(null))

    expect(response.status).toBe(400)
  })

  it('id inexistente: not_found', async () => {
    const { supabase } = createFakeSupabase({ pending_signups: [] })
    vi.doMock('@/lib/supabase/service', () => ({ createServiceClient: () => supabase }))

    const { GET } = await import('../route')
    const response = await GET(makeRequest('ghost-id'))
    const body = await response.json()

    expect(body).toEqual({ status: 'not_found' })
  })

  it('ainda pendente: pending', async () => {
    const { supabase } = createFakeSupabase({ pending_signups: [{ id: 'ps-1', status: 'pending' }] })
    vi.doMock('@/lib/supabase/service', () => ({ createServiceClient: () => supabase }))

    const { GET } = await import('../route')
    const response = await GET(makeRequest('ps-1'))
    const body = await response.json()

    expect(body).toEqual({ status: 'pending' })
  })

  it('pagamento confirmado e conta já provisionada: completed', async () => {
    const { supabase } = createFakeSupabase({ pending_signups: [{ id: 'ps-1', status: 'completed', org_id: 'org-1' }] })
    vi.doMock('@/lib/supabase/service', () => ({ createServiceClient: () => supabase }))

    const { GET } = await import('../route')
    const response = await GET(makeRequest('ps-1'))
    const body = await response.json()

    expect(body).toEqual({ status: 'completed' })
  })
})
