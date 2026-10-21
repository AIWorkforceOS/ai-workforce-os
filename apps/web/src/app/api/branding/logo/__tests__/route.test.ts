import { beforeEach, describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'

/** Rota da logo: só o super admin ou o admin LIBERADO por ele, só da própria empresa; imagem sempre reprocessada; nada é gravado quando recusa. */
type User = { id: string; email: string; name: string | null; role: string; orgId: string | null; orgName: string | null; isSuperAdmin: boolean; unitId: string | null; employeeId: string | null; clientCompany: string | null }
const user = (over: Partial<User>): User => ({ id: 'u1', email: 'a@x', name: null, role: 'admin', orgId: 'org-A', orgName: 'A', isSuperAdmin: false, unitId: null, employeeId: null, clientCompany: null, ...over })

let current: User | null = null
let canManage = false
let previousLogo: string | null = null
const uploads: { path: string; type: string; size: number }[] = []
const removed: string[] = []
const orgUpdates: { payload: Record<string, unknown>; orgId: unknown }[] = []

vi.mock('@/lib/app-user', () => ({ getAppUser: async () => current }))
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      const state: { payload?: Record<string, unknown>; eq?: unknown } = {}
      const q: Record<string, unknown> = {}
      Object.assign(q, {
        select: () => q,
        eq: (_c: string, v: unknown) => { state.eq = v; return q },
        update: (payload: Record<string, unknown>) => { state.payload = payload; return q },
        maybeSingle: async () => ({ data: table === 'users' ? { can_manage_branding: canManage } : { brand_logo_url: previousLogo }, error: null }),
        then: (resolve: (v: unknown) => void) => { if (state.payload && table === 'organizations') orgUpdates.push({ payload: state.payload, orgId: state.eq }); resolve({ error: null }) },
      })
      return q
    },
    storage: {
      from: () => ({
        upload: async (path: string, data: Buffer, opts: { contentType: string }) => { uploads.push({ path, type: opts.contentType, size: data.length }); return { error: null } },
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://p.supabase.co/storage/v1/object/public/org-branding/${path}` } }),
        remove: async (paths: string[]) => { removed.push(...paths); return { error: null } },
      }),
    },
  }),
}))
vi.mock('react', async (orig) => ({ ...(await orig<Record<string, unknown>>()), cache: <T,>(fn: T) => fn }))

const png = () => sharp({ create: { width: 300, height: 120, channels: 4, background: { r: 10, g: 100, b: 200, alpha: 1 } } }).png().toBuffer()
async function post(opts: { file?: Buffer; type?: string; orgId?: string } = {}) {
  const { POST } = await import('../route')
  const form = new FormData()
  form.set('file', new File([new Uint8Array(opts.file ?? (await png()))], 'logo.png', { type: opts.type ?? 'image/png' }))
  if (opts.orgId) form.set('orgId', opts.orgId)
  const res = await POST(new Request('http://x/api/branding/logo', { method: 'POST', body: form }))
  return { status: res.status, body: (await res.json()) as { ok?: boolean; error?: string; logoUrl?: string } }
}
async function del(orgId?: string) {
  const { DELETE } = await import('../route')
  const res = await DELETE(new Request('http://x/api/branding/logo', { method: 'DELETE', body: JSON.stringify({ orgId }) }))
  return { status: res.status, body: (await res.json()) as { ok?: boolean; error?: string } }
}

beforeEach(() => {
  current = user({})
  canManage = false
  previousLogo = null
  uploads.length = 0
  removed.length = 0
  orgUpdates.length = 0
})

describe('POST /api/branding/logo', () => {
  it('sem login: 401', async () => {
    current = null
    expect((await post()).status).toBe(401)
  })
  it('admin SEM a liberação do super admin: 403 e nada é gravado', async () => {
    const r = await post()
    expect(r.status).toBe(403)
    expect(r.body.error).toMatch(/equipe Alizo/)
    expect(uploads).toHaveLength(0)
    expect(orgUpdates).toHaveLength(0)
  })
  it('admin COM a liberação: grava a logo da PRÓPRIA empresa (PNG reprocessado) e troca a URL', async () => {
    canManage = true
    const r = await post()
    expect(r.status).toBe(200)
    expect(uploads).toHaveLength(1)
    expect(uploads[0]!.path).toMatch(/^org-A\/logo-[0-9a-f]{12}\.png$/)
    expect(uploads[0]!.type).toBe('image/png')
    expect(orgUpdates[0]!.orgId).toBe('org-A')
    expect(orgUpdates[0]!.payload.brand_logo_url).toBe(r.body.logoUrl)
    expect(orgUpdates[0]!.payload.brand_logo_updated_by).toBe('u1')
  })
  it('admin liberado que envia o orgId de OUTRA empresa: o orgId é ignorado, vale a própria empresa', async () => {
    canManage = true
    await post({ orgId: 'org-B' })
    expect(uploads[0]!.path.startsWith('org-A/')).toBe(true)
    expect(orgUpdates[0]!.orgId).toBe('org-A')
  })
  it('apaga a logo anterior do nosso bucket ao trocar', async () => {
    canManage = true
    previousLogo = 'https://p.supabase.co/storage/v1/object/public/org-branding/org-A/logo-antiga123456.png'
    await post()
    expect(removed).toEqual(['org-A/logo-antiga123456.png'])
  })
  it('técnico, cliente e visualização: 403 mesmo com a flag (defesa em profundidade)', async () => {
    canManage = true
    for (const role of ['employee', 'client', 'viewer']) {
      current = user({ role })
      expect((await post()).status).toBe(403)
    }
    expect(uploads).toHaveLength(0)
  })
  it('super admin escolhe a empresa', async () => {
    current = user({ role: 'super_admin', isSuperAdmin: true, orgId: null })
    const r = await post({ orgId: 'org-B' })
    expect(r.status).toBe(200)
    expect(uploads[0]!.path.startsWith('org-B/')).toBe(true)
    expect(orgUpdates[0]!.orgId).toBe('org-B')
  })
  it('super admin sem informar a empresa: 403 (não há empresa alvo)', async () => {
    current = user({ role: 'super_admin', isSuperAdmin: true, orgId: null })
    expect((await post()).status).toBe(403)
  })
  it('SVG/script disfarçado ou arquivo inválido: 400 e nada é gravado', async () => {
    canManage = true
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
    expect((await post({ file: svg, type: 'image/svg+xml' })).status).toBe(400)
    expect((await post({ file: svg, type: 'image/png' })).status).toBe(400)
    expect(uploads).toHaveLength(0)
    expect(orgUpdates).toHaveLength(0)
  })
})

describe('DELETE /api/branding/logo', () => {
  it('sem liberação: 403', async () => {
    expect((await del()).status).toBe(403)
  })
  it('com liberação: remove a logo (volta a do Alizo) e apaga o arquivo', async () => {
    canManage = true
    previousLogo = 'https://p.supabase.co/storage/v1/object/public/org-branding/org-A/logo-atual123456.png'
    const r = await del()
    expect(r.status).toBe(200)
    expect(orgUpdates[0]!.payload.brand_logo_url).toBeNull()
    expect(removed).toEqual(['org-A/logo-atual123456.png'])
  })
})
