import { beforeEach, describe, expect, it, vi } from 'vitest'

type Order = { id: string; service_order_status: string | null; quote_decision: string | null; service_order_quote_description_en: string | null; service_order_material_description: string | null }

/** Service client mínimo: registra o filtro de client_company e o update, e devolve a ordem (ou null) configurada. */
function stubService(order: Order | null, updateResult: { data: unknown; error: unknown } = { data: { id: 'a1', quote_decision: 'approved' }, error: null }) {
  const calls: { companyFilter?: unknown; patch?: Record<string, unknown>; isNull?: string } = {}
  const select = {
    eq(col: string, val: unknown) {
      if (col === 'customers.client_company') calls.companyFilter = val
      return select
    },
    maybeSingle: async () => ({ data: order }),
  }
  const update = {
    eq: () => update,
    is(col: string) {
      calls.isNull = col
      return update
    },
    select: () => update,
    maybeSingle: async () => updateResult,
  }
  const service = {
    from: () => ({
      select: () => select,
      update: (patch: Record<string, unknown>) => {
        calls.patch = patch
        return update
      },
    }),
  }
  return { service, calls }
}

async function load(appUser: unknown, service: unknown) {
  vi.doMock('@/lib/app-user', () => ({ getAppUser: async () => appUser }))
  vi.doMock('@/lib/supabase/service', () => ({ createServiceClient: () => service }))
  return import('../route')
}

const req = (body: unknown) => new Request('http://localhost/x', { method: 'POST', body: JSON.stringify(body) })
const params = { params: Promise.resolve({ appointmentId: 'a1' }) }
const client = { id: 'u1', role: 'client', clientCompany: 'ACME' }
const quoteOrder: Order = { id: 'a1', service_order_status: 'quote', quote_decision: null, service_order_quote_description_en: 'Replace panel', service_order_material_description: null }

describe('POST /api/portal-360/orders/[id]/quote-decision', () => {
  beforeEach(() => vi.resetModules())

  it('403 para quem não é cliente (admin, funcionário ou sem sessão)', async () => {
    for (const user of [null, { id: 'u', role: 'admin', clientCompany: null }, { id: 'u', role: 'client', clientCompany: null }]) {
      const { POST } = await load(user, stubService(quoteOrder).service)
      expect((await POST(req({ decision: 'approved' }), params)).status).toBe(403)
    }
  })

  it('404 quando a ordem não é do cliente logado e filtra pela empresa dele', async () => {
    const { service, calls } = stubService(null)
    const { POST } = await load(client, service)
    expect((await POST(req({ decision: 'approved' }), params)).status).toBe(404)
    expect(calls.companyFilter).toBe('ACME')
    expect(calls.patch).toBeUndefined()
  })

  it('aprova e grava só a decisão, com trava contra sobrescrever', async () => {
    const { service, calls } = stubService(quoteOrder)
    const { POST } = await load(client, service)
    const res = await POST(req({ decision: 'approved', note: ' ok ' }), params)
    expect(res.status).toBe(200)
    expect(calls.patch).toMatchObject({ quote_decision: 'approved', quote_decided_by: 'u1', quote_decision_note: 'ok' })
    expect(Object.keys(calls.patch ?? {}).sort()).toEqual(['quote_decided_at', 'quote_decided_by', 'quote_decision', 'quote_decision_note'])
    expect(calls.isNull).toBe('quote_decision')
  })

  it('409 se já decidida, fora de cotação ou corrida (update não achou linha)', async () => {
    let { POST } = await load(client, stubService({ ...quoteOrder, quote_decision: 'approved' }).service)
    expect((await POST(req({ decision: 'rejected' }), params)).status).toBe(409)
    ;({ POST } = await load(client, stubService({ ...quoteOrder, service_order_status: 'completed' }).service))
    expect((await POST(req({ decision: 'approved' }), params)).status).toBe(409)
    ;({ POST } = await load(client, stubService(quoteOrder, { data: null, error: null }).service))
    expect((await POST(req({ decision: 'approved' }), params)).status).toBe(409)
  })

  it('400 para decisão inválida', async () => {
    const { POST } = await load(client, stubService(quoteOrder).service)
    expect((await POST(req({ decision: 'pending' }), params)).status).toBe(400)
  })
})
