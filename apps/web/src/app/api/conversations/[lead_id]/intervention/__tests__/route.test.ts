import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'

// Botões "Assumir atendimento" / "Devolver à automação" da Caixa de
// Entrada (Fase 4, docs/ux-audit-fase1-2026-08-19.md) — cobre o endpoint
// ponta a ponta com o banco falso, incluindo a sequência real de assumir
// e depois devolver.

function makeLeadRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'lead-1',
    unit_id: 'unit-1',
    ...overrides,
  }
}

function makeUnitRow(overrides: Record<string, unknown> = {}) {
  return { id: 'unit-1', org_id: 'org-1', name: 'Matriz', ...overrides }
}

function makeRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/conversations/lead-1/intervention', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

describe('POST /api/conversations/[lead_id]/intervention', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('401 sem sessão autenticada', async () => {
    const { supabase } = createFakeSupabase({ leads: [makeLeadRow()], units: [makeUnitRow()] })
    Object.assign(supabase, { auth: { getUser: async () => ({ data: { user: null } }) } })
    vi.doMock('@/lib/supabase/server', () => ({ createClient: async () => supabase }))

    const { POST } = await import('../route')
    const res = await POST(makeRequest({ action: 'assume' }), { params: Promise.resolve({ lead_id: 'lead-1' }) })
    expect(res.status).toBe(401)
  })

  it('400 com action inválida', async () => {
    const { supabase } = createFakeSupabase({ leads: [makeLeadRow()], units: [makeUnitRow()] })
    Object.assign(supabase, { auth: { getUser: async () => ({ data: { user: { id: 'auth-1' } } }) } })
    vi.doMock('@/lib/supabase/server', () => ({ createClient: async () => supabase }))

    const { POST } = await import('../route')
    const res = await POST(makeRequest({ action: 'nonsense' }), { params: Promise.resolve({ lead_id: 'lead-1' }) })
    expect(res.status).toBe(400)
  })

  it('404 se o lead não existe', async () => {
    const { supabase } = createFakeSupabase({ leads: [], units: [makeUnitRow()] })
    Object.assign(supabase, { auth: { getUser: async () => ({ data: { user: { id: 'auth-1' } } }) } })
    vi.doMock('@/lib/supabase/server', () => ({ createClient: async () => supabase }))

    const { POST } = await import('../route')
    const res = await POST(makeRequest({ action: 'assume' }), { params: Promise.resolve({ lead_id: 'lead-1' }) })
    expect(res.status).toBe(404)
  })

  it('assume grava o evento de intervenção e devolve active:true', async () => {
    const { supabase, db } = createFakeSupabase({ leads: [makeLeadRow()], units: [makeUnitRow()] })
    Object.assign(supabase, { auth: { getUser: async () => ({ data: { user: { id: 'auth-1' } } }) } })
    vi.doMock('@/lib/supabase/server', () => ({ createClient: async () => supabase }))

    const { POST } = await import('../route')
    const res = await POST(makeRequest({ action: 'assume' }), { params: Promise.resolve({ lead_id: 'lead-1' }) })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toMatchObject({ ok: true, active: true })
    expect(db.system_events?.[0]).toMatchObject({ event_type: 'human_operator_message', unit_id: 'unit-1' })
  })

  it('assumir e depois devolver na sequência real deixa active:false', async () => {
    const { supabase, db } = createFakeSupabase({ leads: [makeLeadRow()], units: [makeUnitRow()] })
    Object.assign(supabase, { auth: { getUser: async () => ({ data: { user: { id: 'auth-1' } } }) } })
    vi.doMock('@/lib/supabase/server', () => ({ createClient: async () => supabase }))

    const { POST } = await import('../route')
    await POST(makeRequest({ action: 'assume' }), { params: Promise.resolve({ lead_id: 'lead-1' }) })
    // Garante timestamps distintos (mesma cautela do teste de human-intervention.ts).
    db.system_events![0]!.created_at = new Date(Date.now() - 1000).toISOString()

    const res = await POST(makeRequest({ action: 'release' }), { params: Promise.resolve({ lead_id: 'lead-1' }) })
    const json = await res.json()
    expect(json).toMatchObject({ ok: true, active: false })
  })
})
