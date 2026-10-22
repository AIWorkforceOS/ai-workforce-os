import { beforeEach, describe, expect, it, vi } from 'vitest'

/** Rota do PDF do Sign Off: continua autenticada, respeita a RLS (outra empresa = 404), entrega o nome organizado e escolhe a MARCA por quem pede. */
let user: { id: string } | null = { id: 'u' }
let role = 'admin'
let row: Record<string, unknown> | null = null
let profiles: Record<string, unknown>[] = []
const tablesRead: string[] = []
const generate = vi.fn(async (..._a: unknown[]) => Buffer.from('%PDF-1.7\n' + 'x'.repeat(2000)))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user } }) },
    from: (table: string) => {
      tablesRead.push(table)
      const q: Record<string, unknown> = {}
      Object.assign(q, { select: () => q, eq: () => q, limit: async () => ({ data: profiles, error: null }), maybeSingle: async () => ({ data: row }) })
      return q
    },
  }),
}))
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: () => {
      const q: Record<string, unknown> = {}
      Object.assign(q, { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { name: 'Mawi Pro — Principal', logo_url: 'https://cdn/mawi.png', billing_company_name: 'Mawi Pro Service', billing_address: '4315 E Thunderbird Rd, Phoenix', billing_phone: '9544102114', billing_email: 'info@mawiproservice.com' }, error: null }) })
      return q
    },
  }),
}))
vi.mock('@/lib/app-user', () => ({ getAppUser: async () => (user ? { id: 'u', role } : null) }))
vi.mock('@/lib/branding/org-logo', () => ({ readOrgLogoUrl: async () => null }))
vi.mock('@/lib/service-orders/pdf', () => ({ generateServiceOrderPdf: (...a: unknown[]) => generate(...a) }))
vi.mock('@/lib/service-orders/photo-report', () => ({ generatePhotoReportPdf: async () => null }))
vi.mock('@/lib/service-orders/report-link', () => ({ reportDownloadUrl: () => 'https://x/r' }))

const call = async () => {
  const { GET } = await import('../pdf/route')
  return GET(new Request('http://x/api'), { params: Promise.resolve({ id: 'u1', appointmentId: 'a1' }) })
}
const brandUsed = () => (generate.mock.calls[0]?.[0] as { contractor: { lines: string[]; logoUrl: string | null }; hideClientContact?: boolean })

describe('GET service-order/pdf', () => {
  beforeEach(() => {
    user = { id: 'u' }
    role = 'admin'
    profiles = []
    tablesRead.length = 0
    row = { service_order_number: '6224247', service_order_client_po: '161088-02', service_order_photos: [], public_report_token: null, starts_at: '2026-10-13T13:00:00.000Z', org_id: 'o1', customers: { client_company: 'ACME' } }
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

  describe('marca do Sign Off por quem pede', () => {
    const acme = { id: 'p1', org_id: 'o1', name: 'ACME', logo_url: 'https://cdn/acme.png', address_line1: '1 Main St', address_line2: null, phone: '555', email: 'a@acme.com', website: null, notes: null, is_active: true }

    it('TÉCNICO: sempre a Mawi, sem nada do cliente e sem consultar cadastro de cliente', async () => {
      role = 'employee'
      profiles = [acme]
      expect((await call()).status).toBe(200)
      const { contractor, hideClientContact } = brandUsed()
      expect(contractor.lines[0]).toBe('Mawi Pro Service')
      expect(contractor.lines.join(' ')).not.toMatch(/ACME|Main St|acme/i)
      expect(contractor.logoUrl).toBe('https://cdn/mawi.png')
      expect(hideClientContact).toBe(true)
      expect(tablesRead).not.toContain('client_company_profiles')
    })
    it('ESCRITÓRIO com cliente que tem logo: a marca do cliente', async () => {
      profiles = [acme]
      await call()
      expect(brandUsed().contractor.lines[0]).toBe('ACME')
      expect(brandUsed().contractor.logoUrl).toBe('https://cdn/acme.png')
      expect(brandUsed().hideClientContact).toBe(false)
    })
    it('ESCRITÓRIO com cliente SEM logo: a marca da Mawi', async () => {
      profiles = [{ ...acme, logo_url: null }]
      await call()
      expect(brandUsed().contractor.lines[0]).toBe('Mawi Pro Service')
    })
    it('ESCRITÓRIO com ordem sem cliente vinculado: a marca da Mawi', async () => {
      row = { ...row, customers: { client_company: null } }
      profiles = [acme]
      await call()
      expect(brandUsed().contractor.lines[0]).toBe('Mawi Pro Service')
    })
  })
})
