import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'

const generate = vi.fn(async (..._a: unknown[]) => Buffer.from('%PDF-1.7\n' + 'x'.repeat(500)))
const world = (invoiceStatus = 'sent') =>
  createFakeSupabase({
    invoices: [{ id: 'inv1', unit_id: 'un1', customer_id: 'c1', invoice_number: 'INV-0001', status: invoiceStatus, consolidated_items: null }],
    customers: [{ id: 'c1', client_company: 'ACME', name: 'ACME' }, { id: 'c2', client_company: 'Beta', name: 'Beta' }],
    units: [{ id: 'un1', name: 'Mawi' }],
  })
async function load(actor: unknown, w: ReturnType<typeof world>) {
  vi.resetModules()
  vi.doMock('@/lib/app-user', () => ({ getAppUser: async () => actor }))
  vi.doMock('@/lib/supabase/service', () => ({ createServiceClient: () => w.supabase }))
  vi.doMock('@/lib/invoices/pdf', () => ({ generateInvoicePdf: (...a: unknown[]) => generate(...a) }))
  vi.doMock('@/lib/invoices/consolidated-items', () => ({ withFreshConsolidatedDescriptions: async (_s: unknown, i: unknown) => i }))
  return import('../route')
}
const client = { id: 'u', role: 'client', clientCompany: 'ACME' }
const call = (mod: { GET: (r: Request, c: { params: Promise<{ invoiceId: string }> }) => Promise<Response> }) => mod.GET(new Request('http://x'), { params: Promise.resolve({ invoiceId: 'inv1' }) })

describe('GET /api/portal-360/invoices/[id]/pdf', () => {
  beforeEach(() => generate.mockClear())
  it('só o login de cliente (403 para os demais)', async () => {
    for (const actor of [null, { id: 'a', role: 'admin', clientCompany: null }, { id: 'u', role: 'client', clientCompany: null }]) {
      expect((await call(await load(actor, world()))).status).toBe(403)
    }
    expect(generate).not.toHaveBeenCalled()
  })
  it('fatura emitida do próprio cliente: PDF em inglês', async () => {
    const res = await call(await load(client, world('sent')))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(generate.mock.calls[0]?.[0]).toMatchObject({ locale: 'en' })
  })
  it('fatura de OUTRO cliente é 404 (não revela que existe)', async () => {
    const w = world()
    expect((await call(await load({ ...client, clientCompany: 'Beta' }, w))).status).toBe(404)
    expect(generate).not.toHaveBeenCalled()
  })
  it('rascunho, cancelada ou consolidada não aparecem para o cliente', async () => {
    for (const status of ['draft', 'cancelled', 'consolidated']) expect((await call(await load(client, world(status)))).status).toBe(404)
  })
})
