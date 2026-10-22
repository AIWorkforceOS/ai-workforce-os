import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'

const extract = vi.fn(async () => null)
function world() {
  const fake = createFakeSupabase({
    customers: [{ id: 'c1', unit_id: 'un1', org_id: 'o1', client_company: 'ACME', created_at: '2026-01-01' }],
    units: [{ id: 'un1', timezone: 'America/New_York' }],
    appointments: [],
  })
  const uploaded: string[] = []
  Object.assign(fake.supabase, {
    storage: { from: () => ({ upload: async (path: string) => (uploaded.push(path), { error: null }), getPublicUrl: (p: string) => ({ data: { publicUrl: `https://cdn/${p}` } }) }) },
  })
  return { ...fake, uploaded }
}
async function load(actor: unknown, w: ReturnType<typeof world>) {
  vi.resetModules()
  vi.doMock('@/lib/app-user', () => ({ getAppUser: async () => actor }))
  vi.doMock('@/lib/supabase/service', () => ({ createServiceClient: () => w.supabase }))
  vi.doMock('@/lib/service-orders/extraction', () => ({ extractServiceOrderFromAttachment: extract, isExtractableAttachment: () => true }))
  return import('../route')
}
const client = { id: 'u', role: 'client', clientCompany: 'ACME' }
const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
function req(fields: Record<string, string>, files: { name: string; file: File }[] = []) {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  for (const f of files) fd.append(f.name, f.file)
  return new Request('http://x', { method: 'POST', body: fd })
}
const png = (n = 'p.png') => new File([new Uint8Array([1, 2, 3])], n, { type: 'image/png' })
const pdf = new File([new Uint8Array([1, 2, 3])], 'ordem.pdf', { type: 'application/pdf' })

describe('POST /api/portal-360/orders', () => {
  beforeEach(() => extract.mockClear())

  it('só o login de cliente', async () => {
    const w = world()
    expect((await (await load({ id: 'a', role: 'admin', clientCompany: null }, w)).POST(req({ requestedDate: tomorrow, description: 'x' }))).status).toBe(403)
  })

  it('pedido só com texto + fotos + prioridade + valor/tempo aprovados: cria a ordem sem chamar a IA', async () => {
    const w = world()
    const res = await (await load(client, w)).POST(req({ requestedDate: tomorrow, description: 'Replace the exit sign', priority: 'High', locationName: 'Store 9', approvedAmount: '1200', approvedHours: '5' }, [{ name: 'photos', file: png('a.png') }, { name: 'photos', file: png('b.png') }]))
    expect(res.status).toBe(200)
    expect(extract).not.toHaveBeenCalled()
    const row = w.db.appointments![0]!
    expect(row).toMatchObject({ source: 'service_order_client_portal', employee_id: null, service_order_scope_en: 'Replace the exit sign', service_order_priority: 'High', service_order_location_name: 'Store 9', service_order_file_url: null })
    expect(row.custom_fields).toMatchObject({ client_request: { approvedAmount: 1200, approvedHours: 5, description: 'Replace the exit sign' } })
    expect((row.custom_fields as { client_request: { photos: string[] } }).client_request.photos).toHaveLength(2)
    expect(w.uploaded).toHaveLength(2)
  })

  it('com PDF: faz upload e lê o documento (uma chamada de IA)', async () => {
    const w = world()
    const res = await (await load(client, w)).POST(req({ requestedDate: tomorrow }, [{ name: 'file', file: pdf }]))
    expect(res.status).toBe(200)
    expect(extract).toHaveBeenCalledTimes(1)
    expect(w.db.appointments![0]!.service_order_file_name).toBe('ordem.pdf')
  })

  it('sem arquivo e sem descrição: 400; prioridade/valor inválidos: 400; arquivo ruim: 400', async () => {
    const w = world()
    const mod = await load(client, w)
    expect((await mod.POST(req({ requestedDate: tomorrow }))).status).toBe(400)
    expect((await mod.POST(req({ requestedDate: tomorrow, description: 'x', priority: 'Soon' }))).status).toBe(400)
    expect((await mod.POST(req({ requestedDate: tomorrow, description: 'x', approvedAmount: '-1' }))).status).toBe(400)
    expect((await mod.POST(req({ requestedDate: tomorrow, description: 'x' }, [{ name: 'photos', file: new File([new Uint8Array([1])], 'x.exe', { type: 'application/x-msdownload' }) }]))).status).toBe(400)
    expect(w.db.appointments).toHaveLength(0)
  })

  it('mais de 10 fotos: 400', async () => {
    const w = world()
    const photos = Array.from({ length: 11 }, (_, i) => ({ name: 'photos', file: png(`${i}.png`) }))
    expect((await (await load(client, w)).POST(req({ requestedDate: tomorrow, description: 'x' }, photos))).status).toBe(400)
  })
})
