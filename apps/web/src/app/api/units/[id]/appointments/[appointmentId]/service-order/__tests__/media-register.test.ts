import { beforeEach, describe, expect, it, vi } from 'vitest'

/** Registro em lote de mídia já enviada ao Storage: confere cada arquivo, respeita a RLS e mantém a ordem. */
let visible = true
let user: { id: string } | null = { id: 'u' }
const present = new Map<string, { size: number; contentType: string }>()
let appended: { url: string; kind: string }[] | null = null
let infoCalls = 0

const supabase = {
  auth: { getUser: async () => ({ data: { user } }) },
  from: () => {
    const q: Record<string, unknown> = {}
    Object.assign(q, { select: () => q, eq: () => q, maybeSingle: async () => ({ data: visible ? { id: 'a1' } : null }) })
    return q
  },
  rpc: async (_fn: string, args: { p_items: { url: string; kind: string }[] }) => {
    appended = args.p_items
    return { data: args.p_items, error: null }
  },
  storage: {
    from: () => ({
      info: async (path: string) => {
        infoCalls++
        await new Promise((r) => setTimeout(r, path.endsWith('-0.jpg') ? 8 : 1)) // o 1º demora mais: a ordem do resultado NÃO pode mudar
        const f = present.get(path)
        return f ? { data: { size: f.size, contentType: f.contentType }, error: null } : { data: null, error: new Error('nf') }
      },
      getPublicUrl: (path: string) => ({ data: { publicUrl: `https://files/${path}` } }),
    }),
  },
}
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => supabase }))

const post = async (items: unknown) => {
  const { POST } = await import('../media/route')
  const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ items }) }), { params: Promise.resolve({ id: 'u1', appointmentId: 'a1' }) })
  return { status: res.status, body: (await res.json()) as { ok?: boolean; error?: string; path?: string } }
}
const p = (i: number) => `u1/a1/antes-s-${i}.jpg`

describe('POST service-order/media (registro em lote)', () => {
  beforeEach(() => {
    visible = true
    user = { id: 'u' }
    present.clear()
    appended = null
    infoCalls = 0
    for (let i = 0; i < 5; i++) present.set(p(i), { size: 1000, contentType: 'image/jpeg' })
  })
  it('registra todos de uma vez, na ordem da lista, conferindo cada arquivo no Storage', async () => {
    const r = await post(Array.from({ length: 5 }, (_, i) => ({ path: p(i), kind: 'before' })))
    expect(r.status).toBe(200)
    expect(infoCalls).toBe(5)
    expect(appended!.map((a) => a.url)).toEqual(Array.from({ length: 5 }, (_, i) => `https://files/${p(i)}`))
  })
  it('arquivo ainda não está no bucket: 422 apontando o PRIMEIRO da lista que falta, e nada é registrado', async () => {
    present.delete(p(3))
    present.delete(p(1))
    const r = await post(Array.from({ length: 5 }, (_, i) => ({ path: p(i), kind: 'before' })))
    expect(r.status).toBe(422)
    expect(r.body.path).toBe(p(1))
    expect(appended).toBeNull()
  })
  it('tipo errado (vídeo registrado como foto) e arquivo vazio são recusados', async () => {
    present.set(p(0), { size: 1000, contentType: 'video/mp4' })
    expect((await post([{ path: p(0), kind: 'before' }])).status).toBe(415)
    present.set(p(0), { size: 0, contentType: 'image/jpeg' })
    expect((await post([{ path: p(0), kind: 'before' }])).status).toBe(422)
  })
  it('permissões: sem login 401; ordem de outra empresa 404; caminho de outra ordem 400 — nada é registrado', async () => {
    user = null
    expect((await post([{ path: p(0), kind: 'before' }])).status).toBe(401)
    user = { id: 'u' }
    visible = false
    expect((await post([{ path: p(0), kind: 'before' }])).status).toBe(404)
    visible = true
    expect((await post([{ path: 'outra-unidade/outra-ordem/antes-s-0.jpg', kind: 'before' }])).status).toBe(400)
    expect(appended).toBeNull()
  })
})
