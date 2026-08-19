import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'

// Achado P1.1 da auditoria de 18-19/08/2026: botão administrativo "Retry
// enrichment" (dashboard/leads) — força uma nova tentativa de encontrar
// e-mail agora, sem esperar o próximo ciclo automático. Autorização vem
// inteiramente da sessão (RLS de `leads`), não de checagem manual aqui.

const ensureLeadEnrichment = vi.fn(
  async (_supabase: unknown, lead: Record<string, unknown>) =>
    ({ ...lead, enrichment_status: 'email_found', email: 'novo@padaria.com', enrichment_attempts: 2 }) as never,
)

beforeEach(() => {
  vi.resetModules()
  ensureLeadEnrichment.mockClear()
})

function makeLeadRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'lead-1',
    unit_id: 'unit-1',
    company_name: 'Padaria da Esquina',
    email: null,
    enrichment_status: 'email_not_found',
    enrichment_attempts: 3,
    ...overrides,
  }
}

describe('POST /api/leads/[id]/retry-enrichment', () => {
  it('rejeita sem sessão autenticada (401), sem chamar ensureLeadEnrichment', async () => {
    const { supabase } = createFakeSupabase({ leads: [makeLeadRow()] })
    Object.assign(supabase, { auth: { getUser: async () => ({ data: { user: null } }) } })

    vi.doMock('@/lib/supabase/server', () => ({ createClient: async () => supabase }))
    vi.doMock('@/lib/leads/enrichment', () => ({ ensureLeadEnrichment }))

    const { POST } = await import('../route')
    const response = await POST(new Request('http://test/api/leads/lead-1/retry-enrichment', { method: 'POST' }), {
      params: Promise.resolve({ id: 'lead-1' }),
    })

    expect(response.status).toBe(401)
    expect(ensureLeadEnrichment).not.toHaveBeenCalled()
  })

  it('404 quando o lead não existe (ou RLS nega — mesmo efeito do ponto de vista da API)', async () => {
    const { supabase } = createFakeSupabase({ leads: [] })
    Object.assign(supabase, { auth: { getUser: async () => ({ data: { user: { id: 'auth-1' } } }) } })

    vi.doMock('@/lib/supabase/server', () => ({ createClient: async () => supabase }))
    vi.doMock('@/lib/leads/enrichment', () => ({ ensureLeadEnrichment }))

    const { POST } = await import('../route')
    const response = await POST(new Request('http://test/api/leads/lead-1/retry-enrichment', { method: 'POST' }), {
      params: Promise.resolve({ id: 'lead-1' }),
    })

    expect(response.status).toBe(404)
    expect(ensureLeadEnrichment).not.toHaveBeenCalled()
  })

  it('força a re-pesquisa (force:true) e devolve o novo status/e-mail', async () => {
    const { supabase } = createFakeSupabase({ leads: [makeLeadRow()] })
    Object.assign(supabase, { auth: { getUser: async () => ({ data: { user: { id: 'auth-1' } } }) } })

    vi.doMock('@/lib/supabase/server', () => ({ createClient: async () => supabase }))
    vi.doMock('@/lib/leads/enrichment', () => ({ ensureLeadEnrichment }))

    const { POST } = await import('../route')
    const response = await POST(new Request('http://test/api/leads/lead-1/retry-enrichment', { method: 'POST' }), {
      params: Promise.resolve({ id: 'lead-1' }),
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ ok: true, enrichment_status: 'email_found', email: 'novo@padaria.com', enrichment_attempts: 2 })
    expect(ensureLeadEnrichment).toHaveBeenCalledTimes(1)
    const [, leadArg, optionsArg] = ensureLeadEnrichment.mock.calls[0] as [unknown, Record<string, unknown>, { force?: boolean }]
    expect(leadArg.id).toBe('lead-1')
    expect(optionsArg).toEqual({ force: true })
  })
})
