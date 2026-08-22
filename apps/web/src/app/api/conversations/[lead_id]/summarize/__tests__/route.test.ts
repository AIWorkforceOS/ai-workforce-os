import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'

function makeRequest() {
  return new Request('http://localhost/api/conversations/lead-1/summarize', { method: 'POST' })
}

describe('POST /api/conversations/[lead_id]/summarize', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('401 sem sessão', async () => {
    const { supabase } = createFakeSupabase()
    Object.assign(supabase, { auth: { getUser: async () => ({ data: { user: null } }) } })
    vi.doMock('@/lib/supabase/server', () => ({ createClient: async () => supabase }))

    const { POST } = await import('../route')
    const res = await POST(makeRequest(), { params: Promise.resolve({ lead_id: 'lead-1' }) })
    expect(res.status).toBe(401)
  })

  it('503 sem OPENAI_API_KEY configurada — falha graciosa, não quebra a tela', async () => {
    const { supabase } = createFakeSupabase()
    Object.assign(supabase, { auth: { getUser: async () => ({ data: { user: { id: 'auth-1' } } }) } })
    vi.doMock('@/lib/supabase/server', () => ({ createClient: async () => supabase }))
    vi.doMock('@/lib/openai', () => ({ getOpenAIApiKey: () => null }))

    const { POST } = await import('../route')
    const res = await POST(makeRequest(), { params: Promise.resolve({ lead_id: 'lead-1' }) })
    expect(res.status).toBe(503)
    const json = await res.json()
    expect(json.error).toBe('not_configured')
  })

  it('422 quando não há mensagens ainda', async () => {
    const { supabase } = createFakeSupabase({ conversations: [] })
    Object.assign(supabase, { auth: { getUser: async () => ({ data: { user: { id: 'auth-1' } } }) } })
    vi.doMock('@/lib/supabase/server', () => ({ createClient: async () => supabase }))
    vi.doMock('@/lib/openai', () => ({ getOpenAIApiKey: () => 'fake-key' }))

    const { POST } = await import('../route')
    const res = await POST(makeRequest(), { params: Promise.resolve({ lead_id: 'lead-1' }) })
    expect(res.status).toBe(422)
  })

  it('200 com summary/intent quando tudo dá certo', async () => {
    const { supabase } = createFakeSupabase({
      conversations: [
        { id: 'c1', lead_id: 'lead-1', unit_id: 'unit-1', direction: 'inbound', content: 'Quero orçamento', channel: 'whatsapp', status: 'delivered', sent_at: '2026-08-20T10:00:00.000Z' },
      ],
    })
    Object.assign(supabase, { auth: { getUser: async () => ({ data: { user: { id: 'auth-1' } } }) } })
    vi.doMock('@/lib/supabase/server', () => ({ createClient: async () => supabase }))
    vi.doMock('@/lib/openai', () => ({ getOpenAIApiKey: () => 'fake-key' }))
    vi.doMock('@/lib/leads/conversation-summary', () => ({
      formatTranscript: (rows: unknown[]) => `${rows.length} mensagens`,
      summarizeConversation: vi.fn(async () => ({ summary: 'Quer orçamento.', intent: 'quer orçamento' })),
    }))

    const { POST } = await import('../route')
    const res = await POST(makeRequest(), { params: Promise.resolve({ lead_id: 'lead-1' }) })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toMatchObject({ ok: true, summary: 'Quer orçamento.', intent: 'quer orçamento' })
  })
})
