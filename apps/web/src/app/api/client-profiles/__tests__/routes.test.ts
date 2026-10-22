import { beforeEach, describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'

/** Cadastro de cliente (Facility) e logo: só administrador; dados e logo do cliente nunca cruzam empresas (a RLS também garante). */
type User = { id: string; email: string; name: string | null; role: string; orgId: string | null; orgName: string | null; isSuperAdmin: boolean; unitId: string | null; employeeId: string | null; clientCompany: string | null }
const user = (over: Partial<User> = {}): User => ({ id: 'u1', email: 'a@x', name: null, role: 'admin', orgId: 'org-A', orgName: 'A', isSuperAdmin: false, unitId: null, employeeId: null, clientCompany: null, ...over })

let current: User | null = null
let insertError: { code: string } | null = null
let existingProfile: { id: string; org_id: string; logo_url: string | null } | null = null
let updateReturnsRow = true
let units: { id: string }[] = []
let customerExists = false
let customerInsertError = false
const inserted: { table: string; row: Record<string, unknown> }[] = []
const updated: { table: string; payload: Record<string, unknown>; id: unknown }[] = []
const uploads: { path: string; type: string }[] = []
const removed: string[] = []

const fakeUserClient = {
  from: (table: string) => {
    const state: { payload?: Record<string, unknown>; eq: unknown[]; mode?: 'insert' | 'update' } = { eq: [] }
    const q: Record<string, unknown> = {}
    Object.assign(q, {
      select: () => q,
      eq: (_c: string, v: unknown) => { state.eq.push(v); return q },
      ilike: () => q,
      limit: () => q,
      order: () => q,
      insert: (row: Record<string, unknown>) => { inserted.push({ table, row }); state.mode = 'insert'; return q },
      update: (payload: Record<string, unknown>) => { state.payload = payload; state.mode = 'update'; return q },
      single: async () => (insertError ? { data: null, error: insertError } : { data: { id: 'new-1', org_id: inserted.at(-1)?.row.org_id, name: inserted.at(-1)?.row.name }, error: null }),
      maybeSingle: async () => {
        if (state.mode === 'update') { updated.push({ table, payload: state.payload ?? {}, id: state.eq[0] }); return { data: updateReturnsRow ? { id: 'p1' } : null, error: null } }
        if (table === 'customers') return { data: customerExists ? { id: 'c1' } : null, error: null }
        return { data: existingProfile, error: null }
      },
      then: (resolve: (v: unknown) => void) => {
        if (state.mode === 'insert' && table === 'customers') return resolve({ error: customerInsertError ? { message: 'x' } : null })
        if (table === 'units') return resolve({ data: units, error: null })
        resolve({ data: [], error: null })
      },
    })
    return q
  },
}
const fakeService = {
  storage: {
    from: () => ({
      upload: async (path: string, _d: Buffer, o: { contentType: string }) => { uploads.push({ path, type: o.contentType }); return { error: null } },
      getPublicUrl: (path: string) => ({ data: { publicUrl: `https://p.supabase.co/storage/v1/object/public/org-branding/${path}` } }),
      remove: async (p: string[]) => { removed.push(...p); return { error: null } },
    }),
  },
}
vi.mock('@/lib/app-user', () => ({ getAppUser: async () => current }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => fakeUserClient }))
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => fakeService }))
vi.mock('react', async (orig) => ({ ...(await orig<Record<string, unknown>>()), cache: <T,>(fn: T) => fn }))

const json = (b: unknown) => new Request('http://x', { method: 'POST', body: JSON.stringify(b) })
const params = (id = 'p1') => ({ params: Promise.resolve({ id }) })
const png = () => sharp({ create: { width: 300, height: 120, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 1 } } }).png().toBuffer()

beforeEach(() => {
  current = user()
  insertError = null
  existingProfile = { id: 'p1', org_id: 'org-A', logo_url: null }
  updateReturnsRow = true
  units = [{ id: 'unit-1' }, { id: 'unit-2' }]
  customerExists = false
  customerInsertError = false
  inserted.length = 0
  updated.length = 0
  uploads.length = 0
  removed.length = 0
})

describe('POST /api/client-profiles', () => {
  it('sem login 401; técnico, cliente e visualização 403 — nada é gravado', async () => {
    const { POST } = await import('../route')
    current = null
    expect((await POST(json({ name: 'Acme' }))).status).toBe(401)
    for (const role of ['employee', 'client', 'viewer']) {
      current = user({ role })
      expect((await POST(json({ name: 'Acme' }))).status).toBe(403)
    }
    expect(inserted).toHaveLength(0)
  })
  it('admin cadastra para a PRÓPRIA empresa (um orgId enviado por ele é ignorado) e cria o vínculo com cada unidade', async () => {
    const { POST } = await import('../route')
    const res = await POST(json({ name: '  Acme   Facility ', orgId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301', phone: '555-0100', email: '' }))
    expect(res.status).toBe(201)
    const profile = inserted.find((i) => i.table === 'client_company_profiles')!.row
    expect(profile.org_id).toBe('org-A')
    expect(profile.name).toBe('Acme Facility')
    expect(profile.email).toBeNull()
    const customers = inserted.filter((i) => i.table === 'customers').map((i) => i.row)
    expect(customers).toHaveLength(2)
    expect(customers[0]).toMatchObject({ org_id: 'org-A', unit_id: 'unit-1', name: 'Acme Facility', client_company: 'Acme Facility' })
  })
  it('super admin escolhe a empresa', async () => {
    const { POST } = await import('../route')
    current = user({ role: 'super_admin', isSuperAdmin: true, orgId: null })
    const res = await POST(json({ name: 'Acme', orgId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301' }))
    expect(res.status).toBe(201)
    expect(inserted.find((i) => i.table === 'client_company_profiles')!.row.org_id).toBe('3f2504e0-4f89-41d3-9a0c-0305e82c3301')
  })
  it('prazo padrão de pagamento (Net): grava o número de dias; negativo ou acima de 365 é recusado', async () => {
    const { POST } = await import('../route')
    expect((await POST(json({ name: 'Acme', payment_terms_days: 15 }))).status).toBe(201)
    expect(inserted.find((i) => i.table === 'client_company_profiles')!.row.payment_terms_days).toBe(15)
    expect((await POST(json({ name: 'Beta', payment_terms_days: -1 }))).status).toBe(400)
    expect((await POST(json({ name: 'Beta', payment_terms_days: 400 }))).status).toBe(400)
    expect((await POST(json({ name: 'Beta', payment_terms_days: 12.5 }))).status).toBe(400)
  })
  it('nome vazio 400; nome repetido 409; sem permissão no banco 403', async () => {
    const { POST } = await import('../route')
    expect((await POST(json({ name: '   ' }))).status).toBe(400)
    insertError = { code: '23505' }
    expect((await POST(json({ name: 'Acme' }))).status).toBe(409)
    insertError = { code: '42501' }
    expect((await POST(json({ name: 'Acme' }))).status).toBe(403)
  })
  it('já existe o cliente na unidade: não duplica; falha no vínculo NÃO desfaz o cadastro (avisa)', async () => {
    const { POST } = await import('../route')
    customerExists = true
    await POST(json({ name: 'Acme' }))
    expect(inserted.filter((i) => i.table === 'customers')).toHaveLength(0)
    customerExists = false
    customerInsertError = true
    const res = await POST(json({ name: 'Acme2' }))
    expect(res.status).toBe(201)
    expect(((await res.json()) as { warning: string | null }).warning).toMatch(/vínculo/)
  })
})

describe('PATCH /api/client-profiles/[id]', () => {
  it('técnico 403; admin edita os dados; nome vazio (400); inexistente/outra empresa 404', async () => {
    const { PATCH } = await import('../[id]/route')
    const patch = (b: unknown) => PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify(b) }), params())
    current = user({ role: 'employee' })
    expect((await patch({ phone: '1' })).status).toBe(403)
    current = user()
    expect((await patch({ phone: ' 555-0199 ', address_line1: '' })).status).toBe(200)
    expect(updated.at(-1)!.payload).toEqual({ phone: '555-0199', address_line1: null })
    expect((await patch({ name: '   ' })).status).toBe(400)
    updateReturnsRow = false // a RLS não devolve a linha: outra empresa
    expect((await patch({ phone: '1' })).status).toBe(404)
  })
})

describe('logo do cliente', () => {
  const postLogo = async (file: Buffer, type = 'image/png') => {
    const { POST } = await import('../[id]/logo/route')
    const form = new FormData()
    form.set('file', new File([new Uint8Array(file)], 'logo.png', { type }))
    return POST(new Request('http://x', { method: 'POST', body: form }), params())
  }
  it('admin envia a logo do cliente: PNG reprocessado na pasta do cliente, URL salva, logo anterior apagada', async () => {
    existingProfile = { id: 'p1', org_id: 'org-A', logo_url: 'https://p.supabase.co/storage/v1/object/public/org-branding/org-A/clients/p1/logo-antiga123456.png' }
    const res = await postLogo(await png())
    expect(res.status).toBe(200)
    expect(uploads[0]!.path).toMatch(/^org-A\/clients\/p1\/logo-[0-9a-f]{12}\.png$/)
    expect(uploads[0]!.type).toBe('image/png')
    expect(updated.at(-1)!.payload.logo_url).toMatch(/^https:\/\//)
    expect(removed).toEqual(['org-A/clients/p1/logo-antiga123456.png'])
  })
  it('técnico 403; cliente inexistente/de outra empresa 404; SVG/script 400 — nada é enviado', async () => {
    current = user({ role: 'employee' })
    expect((await postLogo(await png())).status).toBe(403)
    current = user()
    existingProfile = null
    expect((await postLogo(await png())).status).toBe(404)
    existingProfile = { id: 'p1', org_id: 'org-A', logo_url: null }
    expect((await postLogo(Buffer.from('<svg><script>alert(1)</script></svg>'), 'image/svg+xml')).status).toBe(400)
    expect(uploads).toHaveLength(0)
  })
  it('remover a logo volta ao selo de iniciais e apaga o arquivo', async () => {
    existingProfile = { id: 'p1', org_id: 'org-A', logo_url: 'https://p.supabase.co/storage/v1/object/public/org-branding/org-A/clients/p1/logo-atual123456.png' }
    const { DELETE } = await import('../[id]/logo/route')
    const res = await DELETE(new Request('http://x', { method: 'DELETE' }), params())
    expect(res.status).toBe(200)
    expect(updated.at(-1)!.payload).toEqual({ logo_url: null })
    expect(removed).toEqual(['org-A/clients/p1/logo-atual123456.png'])
  })
})
