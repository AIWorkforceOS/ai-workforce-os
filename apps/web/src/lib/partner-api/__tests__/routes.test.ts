import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'
import { generatePartnerKey } from '@/lib/partner-api/auth'

const { state, triggerFirstContactMock } = vi.hoisted(() => ({
  state: { supabase: null as unknown },
  triggerFirstContactMock: vi.fn(async () => true),
}))

vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => state.supabase }))
vi.mock('@/lib/leads/lead-intake', () => ({ triggerFirstContact: triggerFirstContactMock }))
vi.mock('@/lib/sales/smarter-crm', () => ({ syncLeadToSmarterCrm: vi.fn(async () => undefined) }))
vi.mock('@/lib/conversation-engine', () => ({
  countSentToday: vi.fn(async () => 0),
  sendAcrossChannels: vi.fn(async () => ({ anySent: true, attempts: [{ channel: 'whatsapp', ok: true }] })),
}))

const UNIT = { id: 'u1', org_id: 'org-1', slug: 'matriz', name: 'Matriz', is_active: true }
const OTHER_ORG_UNIT = { id: 'u9', org_id: 'org-2', slug: 'outra', name: 'Outra', is_active: true }

function setup(scopes: string[], extra: Record<string, unknown[]> = {}) {
  const generated = generatePartnerKey()
  const keyRow = {
    id: `k-${Math.random().toString(36).slice(2, 8)}`,
    org_id: 'org-1',
    unit_id: null,
    scopes,
    key_hash: generated.hash,
    revoked_at: null,
    expires_at: null,
    last_used_at: new Date().toISOString(),
  }
  const fake = createFakeSupabase({ partner_api_keys: [keyRow], units: [UNIT, OTHER_ORG_UNIT], ...extra })
  state.supabase = fake.supabase
  return { key: generated.key, ...fake }
}

const post = (key: string, body: unknown) =>
  new Request('https://alizo.test/api/partner/v1/leads', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

beforeEach(() => triggerFirstContactMock.mockClear())

describe('POST /api/partner/v1/leads', () => {
  it('cria o lead, dispara o primeiro contato e devolve 201', async () => {
    const { key, db } = setup(['leads:write'])
    const { POST } = await import('@/app/api/partner/v1/leads/route')

    const res = await POST(post(key, { unit_slug: 'matriz', name: 'Maria', phone: '(11) 99999-0000', source: 'smarter_site', external_id: 'ext-1' }))
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json).toMatchObject({ ok: true, duplicate: false, contacted: true })
    expect(db.leads).toHaveLength(1)
    expect(db.leads![0]).toMatchObject({ unit_id: 'u1', phone: '11999990000', status: 'new', external_lead_id: 'ext-1' })
    expect(triggerFirstContactMock).toHaveBeenCalledTimes(1)
  })

  it('é idempotente por telefone e por (source, external_id): não duplica nem recontata', async () => {
    const { key, db } = setup(['leads:write'])
    const { POST } = await import('@/app/api/partner/v1/leads/route')
    const payload = { unit_id: 'u1', name: 'Maria', phone: '11999990000', source: 'smarter_site', external_id: 'ext-1' }

    await POST(post(key, payload))
    triggerFirstContactMock.mockClear()

    const samePhone = await POST(post(key, { ...payload, external_id: 'ext-2' }))
    const sameExternal = await POST(post(key, { ...payload, phone: '11888880000' }))

    expect((await samePhone.json()).duplicate).toBe(true)
    expect((await sameExternal.json()).duplicate).toBe(true)
    expect(db.leads).toHaveLength(1)
    expect(triggerFirstContactMock).not.toHaveBeenCalled()
  })

  it('first_contact=false cria o lead pausado e não dispara contato', async () => {
    const { key, db } = setup(['leads:write'])
    const { POST } = await import('@/app/api/partner/v1/leads/route')

    const res = await POST(post(key, { unit_id: 'u1', name: 'Empresa X', phone: '11999990001', first_contact: false }))

    expect(res.status).toBe(201)
    expect(db.leads![0]).toMatchObject({ status: 'paused' })
    expect(triggerFirstContactMock).not.toHaveBeenCalled()
  })

  it('404 para unidade de outra organização (sem vazar que existe)', async () => {
    const { key, db } = setup(['leads:write'])
    const { POST } = await import('@/app/api/partner/v1/leads/route')

    const res = await POST(post(key, { unit_id: 'u9', name: 'Maria', phone: '11999990000' }))

    expect(res.status).toBe(404)
    expect(db.leads ?? []).toHaveLength(0)
  })

  it('400 para telefone inválido e 403 sem o escopo leads:write', async () => {
    const { key } = setup(['leads:write'])
    const { POST } = await import('@/app/api/partner/v1/leads/route')
    expect((await POST(post(key, { unit_id: 'u1', name: 'Maria', phone: '123' }))).status).toBe(400)

    const readOnly = setup(['leads:read'])
    expect((await POST(post(readOnly.key, { unit_id: 'u1', name: 'Maria', phone: '11999990000' }))).status).toBe(403)
  })
})

describe('GET /api/partner/v1/leads', () => {
  it('lista só leads das unidades da organização da chave', async () => {
    const { key } = setup(['leads:read'], {
      leads: [
        { id: 'l1', unit_id: 'u1', company_name: 'A', phone: '1', status: 'new', created_at: '2026-01-02T00:00:00Z', updated_at: '2026-01-02T00:00:00Z' },
        { id: 'l2', unit_id: 'u9', company_name: 'B', phone: '2', status: 'new', created_at: '2026-01-03T00:00:00Z', updated_at: '2026-01-03T00:00:00Z' },
      ],
    })
    const { GET } = await import('@/app/api/partner/v1/leads/route')

    const res = await GET(new Request('https://alizo.test/api/partner/v1/leads', { headers: { authorization: `Bearer ${key}` } }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.leads.map((l: { id: string }) => l.id)).toEqual(['l1'])
  })
})

describe('POST /api/partner/v1/webhooks', () => {
  it('cria o webhook devolvendo o secret uma vez e recusa URL interna', async () => {
    const { key, db } = setup(['webhooks:manage'])
    const { POST } = await import('@/app/api/partner/v1/webhooks/route')
    const req = (body: unknown) =>
      new Request('https://alizo.test/api/partner/v1/webhooks', {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })

    const ok = await POST(req({ url: 'https://parceiro.test/hook', events: ['lead.created'] }))
    const json = await ok.json()
    expect(ok.status).toBe(201)
    expect(json.secret).toMatch(/^whsec_/)
    expect(json.webhook.secret).toBeUndefined()
    expect(db.partner_webhook_endpoints).toHaveLength(1)

    expect((await POST(req({ url: 'https://127.0.0.1/hook' }))).status).toBe(400)
    expect((await POST(req({ url: 'https://parceiro.test/hook', events: ['nao.existe'] }))).status).toBe(400)
  })
})
