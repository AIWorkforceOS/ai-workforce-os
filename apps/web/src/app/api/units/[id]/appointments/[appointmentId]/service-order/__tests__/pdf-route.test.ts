import { beforeEach, describe, expect, it, vi } from 'vitest'

/** Rota do PDF do Sign Off: continua autenticada, respeita a RLS (outra empresa = 404) e entrega o nome organizado. */
let user: { id: string } | null = { id: 'u' }
let row: Record<string, unknown> | null = null
const generate = vi.fn(async () => Buffer.from('%PDF-1.7\n' + 'x'.repeat(2000)))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user } }) },
    from: () => {
      const q: Record<string, unknown> = {}
      Object.assign(q, { select: () => q, eq: () => q, maybeSingle: async () => ({ data: row }) })
      return q
    },
  }),
}))
vi.mock('@/lib/service-orders/pdf', () => ({ generateServiceOrderPdf: (...a: unknown[]) => generate(...(a as [])) }))
vi.mock('@/lib/service-orders/photo-report', () => ({ generatePhotoReportPdf: async () => null }))
vi.mock('@/lib/service-orders/report-link', () => ({ reportDownloadUrl: () => 'https://x/r' }))

const call = async () => {
  const { GET } = await import('../pdf/route')
  return GET(new Request('http://x/api'), { params: Promise.resolve({ id: 'u1', appointmentId: 'a1' }) })
}

describe('GET service-order/pdf', () => {
  beforeEach(() => {
    user = { id: 'u' }
    row = { service_order_number: '6224247', service_order_client_po: '161088-02', service_order_photos: [], public_report_token: null, starts_at: '2026-10-13T13:00:00.000Z' }
    generate.mockClear()
  })
  it('sem login: 401 e nada é gerado', async () => {
    user = null
    expect((await call()).status).toBe(401)
    expect(generate).not.toHaveBeenCalled()
  })
  it('ordem de outra empresa/sem permissão (a RLS não devolve a linha): 404 e nada é gerado', async () => {
    row = null
    expect((await call()).status).toBe(404)
    expect(generate).not.toHaveBeenCalled()
  })
  it('ordem do usuário: PDF real, nome SignOff_PO-…-data.pdf, sem cache compartilhado', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="SignOff_PO-161088-02-2026-10-13.pdf"')
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(new TextDecoder().decode((await res.arrayBuffer()).slice(0, 5))).toBe('%PDF-')
  })
})
