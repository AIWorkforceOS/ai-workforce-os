import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'
import {
  authenticatePartner,
  generatePartnerKey,
  hashPartnerKey,
  isPartnerContext,
  resolvePartnerUnit,
} from '@/lib/partner-api/auth'
import { emitPartnerEvent, signWebhookPayload, validateWebhookUrl } from '@/lib/partner-api/webhooks'
import { NextResponse } from 'next/server'

function seedKey(overrides: Record<string, unknown> = {}) {
  const generated = generatePartnerKey()
  const row: Record<string, unknown> = {
    id: `key-${Math.random().toString(36).slice(2, 8)}`,
    org_id: 'org-1',
    unit_id: null,
    name: 'Smarter',
    key_prefix: generated.prefix,
    key_hash: generated.hash,
    scopes: ['leads:read', 'leads:write'],
    last_used_at: new Date().toISOString(),
    expires_at: null,
    revoked_at: null,
    ...overrides,
  }
  return { key: generated.key, row }
}

const request = (key?: string) =>
  new Request('https://alizo.test/api/partner/v1/leads', {
    headers: key ? { authorization: `Bearer ${key}` } : {},
  })

describe('generatePartnerKey', () => {
  it('gera chave no formato esperado e o hash confere', () => {
    const { key, prefix, hash } = generatePartnerKey()
    expect(key).toMatch(/^alz_live_[0-9a-f]{8}_[A-Za-z0-9_-]{43}$/)
    expect(key.startsWith(prefix)).toBe(true)
    expect(hashPartnerKey(key)).toBe(hash)
  })

  it('nunca repete', () => {
    expect(generatePartnerKey().key).not.toBe(generatePartnerKey().key)
  })
})

describe('authenticatePartner', () => {
  it('401 sem cabeçalho ou com chave de formato errado', async () => {
    const { supabase } = createFakeSupabase()
    for (const req of [request(), request('qualquer-coisa')]) {
      const result = await authenticatePartner(req, 'leads:read', supabase)
      expect(result).toBeInstanceOf(NextResponse)
      expect((result as NextResponse).status).toBe(401)
    }
  })

  it('401 para chave inexistente', async () => {
    const { supabase } = createFakeSupabase({ partner_api_keys: [] })
    const result = await authenticatePartner(request(generatePartnerKey().key), 'leads:read', supabase)
    expect((result as NextResponse).status).toBe(401)
  })

  it('401 para chave revogada e expirada', async () => {
    const revoked = seedKey({ revoked_at: new Date().toISOString() })
    const expired = seedKey({ expires_at: new Date(Date.now() - 1000).toISOString() })
    const { supabase } = createFakeSupabase({ partner_api_keys: [revoked.row, expired.row] })

    expect(((await authenticatePartner(request(revoked.key), 'leads:read', supabase)) as NextResponse).status).toBe(401)
    expect(((await authenticatePartner(request(expired.key), 'leads:read', supabase)) as NextResponse).status).toBe(401)
  })

  it('403 quando falta o escopo', async () => {
    const { key, row } = seedKey({ scopes: ['leads:read'] })
    const { supabase } = createFakeSupabase({ partner_api_keys: [row] })
    const result = await authenticatePartner(request(key), 'messages:send', supabase)
    expect((result as NextResponse).status).toBe(403)
  })

  it('devolve o contexto da organização quando tudo confere', async () => {
    const { key, row } = seedKey()
    const { supabase } = createFakeSupabase({ partner_api_keys: [row] })
    const result = await authenticatePartner(request(key), 'leads:write', supabase)
    expect(isPartnerContext(result)).toBe(true)
    if (isPartnerContext(result)) {
      expect(result.orgId).toBe('org-1')
      expect(result.unitId).toBeNull()
    }
  })

  it('429 depois de 120 requisições por minuto na mesma chave', async () => {
    const { key, row } = seedKey()
    const { supabase } = createFakeSupabase({ partner_api_keys: [row] })
    let last: unknown
    for (let i = 0; i < 121; i += 1) {
      last = await authenticatePartner(request(key), 'leads:read', supabase)
    }
    expect((last as NextResponse).status).toBe(429)
  })
})

describe('resolvePartnerUnit (isolamento)', () => {
  const units = [
    { id: 'u1', org_id: 'org-1', slug: 'matriz', is_active: true },
    { id: 'u2', org_id: 'org-1', slug: 'filial', is_active: true },
    { id: 'u3', org_id: 'org-2', slug: 'outra-org', is_active: true },
  ]

  it('não enxerga unidade de outra organização (nem por id nem por slug)', async () => {
    const { supabase } = createFakeSupabase({ units })
    const ctx = { supabase, keyId: 'k', orgId: 'org-1', unitId: null, scopes: [] }
    expect(await resolvePartnerUnit(ctx, { unitId: 'u3' })).toBeNull()
    expect(await resolvePartnerUnit(ctx, { unitSlug: 'outra-org' })).toBeNull()
    expect((await resolvePartnerUnit(ctx, { unitSlug: 'filial' }))?.id).toBe('u2')
  })

  it('chave restrita a uma unidade só acessa ela e a assume por padrão', async () => {
    const { supabase } = createFakeSupabase({ units })
    const ctx = { supabase, keyId: 'k', orgId: 'org-1', unitId: 'u1', scopes: [] }
    expect(await resolvePartnerUnit(ctx, { unitId: 'u2' })).toBeNull()
    expect((await resolvePartnerUnit(ctx, {}))?.id).toBe('u1')
  })

  it('chave sem restrição exige informar a unidade', async () => {
    const { supabase } = createFakeSupabase({ units })
    const ctx = { supabase, keyId: 'k', orgId: 'org-1', unitId: null, scopes: [] }
    expect(await resolvePartnerUnit(ctx, {})).toBeNull()
  })
})

describe('validateWebhookUrl', () => {
  it('aceita https público', () => {
    expect(validateWebhookUrl('https://sistema.smarterestagios.com.br/hooks/alizo').ok).toBe(true)
  })

  it.each([
    'http://exemplo.com/x',
    'https://localhost/x',
    'https://127.0.0.1/x',
    'https://10.1.2.3/x',
    'https://192.168.0.5/x',
    'https://172.20.0.1/x',
    'https://169.254.169.254/latest',
    'https://servico.internal/x',
    'https://user:pass@exemplo.com/x',
    'nao-e-url',
  ])('recusa %s', (url) => {
    expect(validateWebhookUrl(url).ok).toBe(false)
  })
})

describe('emitPartnerEvent', () => {
  afterEach(() => vi.unstubAllGlobals())

  function setup(extra: Record<string, unknown[]> = {}) {
    const { key, row } = seedKey()
    void key
    const endpoint = {
      id: 'ep-1',
      org_id: 'org-1',
      api_key_id: row.id as string,
      url: 'https://parceiro.test/hook',
      secret: 'whsec_teste',
      events: ['*'],
      is_active: true,
    }
    return { row, endpoint, ...createFakeSupabase({ partner_api_keys: [row], partner_webhook_endpoints: [endpoint], ...extra }) }
  }

  it('grava o evento, entrega com assinatura HMAC válida e registra a entrega', async () => {
    const fetchMock = vi.fn(async () => new Response('ok', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { supabase, db } = setup()

    await emitPartnerEvent(supabase, { orgId: 'org-1', unitId: 'u1', type: 'lead.message.received', data: { lead_id: 'l1', text: 'oi' } })

    expect(db.partner_events).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://parceiro.test/hook')
    const headers = init.headers as Record<string, string>
    const match = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(headers['Alizo-Signature']!)
    expect(match).not.toBeNull()
    expect(match![2]).toBe(signWebhookPayload('whsec_teste', Number(match![1]), init.body as string))
    expect(JSON.parse(init.body as string)).toMatchObject({ type: 'lead.message.received', unit_id: 'u1', data: { text: 'oi' } })
    expect(db.partner_webhook_deliveries).toHaveLength(1)
    expect(db.partner_webhook_deliveries![0]).toMatchObject({ ok: true, status_code: 200 })
  })

  it('registra falha sem lançar quando o parceiro está fora do ar', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED') }))
    const { supabase, db } = setup()

    await expect(
      emitPartnerEvent(supabase, { orgId: 'org-1', unitId: 'u1', type: 'lead.created', data: {} }),
    ).resolves.toBeUndefined()
    expect(db.partner_webhook_deliveries![0]).toMatchObject({ ok: false, error: 'Erro de conexão' })
  })

  it('não entrega para endpoint que não assina o tipo, nem para chave revogada', async () => {
    const fetchMock = vi.fn(async () => new Response('ok'))
    vi.stubGlobal('fetch', fetchMock)
    const { supabase, endpoint, row } = setup()
    endpoint.events = ['lead.created']
    await emitPartnerEvent(supabase, { orgId: 'org-1', unitId: 'u1', type: 'lead.message.sent', data: {} })
    expect(fetchMock).not.toHaveBeenCalled()

    endpoint.events = ['*']
    row.revoked_at = new Date().toISOString()
    await emitPartnerEvent(supabase, { orgId: 'org-1', unitId: 'u1', type: 'lead.message.sent', data: {} })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('chave restrita a outra unidade não recebe o evento', async () => {
    const fetchMock = vi.fn(async () => new Response('ok'))
    vi.stubGlobal('fetch', fetchMock)
    const { supabase, row } = setup()
    row.unit_id = 'u-outra'
    await emitPartnerEvent(supabase, { orgId: 'org-1', unitId: 'u1', type: 'lead.created', data: {} })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sem chave de parceiro na org, não grava nada', async () => {
    const { supabase, db } = createFakeSupabase()
    await emitPartnerEvent(supabase, { orgId: 'org-1', unitId: 'u1', type: 'lead.created', data: {} })
    expect(db.partner_events ?? []).toHaveLength(0)
  })
})
