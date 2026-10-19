import { beforeEach, describe, expect, it, vi } from 'vitest'

/** Reenvio de fotos depois de perda de conexão: nunca falha à toa, nunca duplica. */
type Photo = { url: string; uploaded_at: string; kind: string }
let stored: Photo[] = []
const uploads: string[] = []
let updates = 0

const row = () => ({ id: 'a1', unit_id: 'u1', service_order_photos: stored, service_order_signature_url: null, employee_id: null, checked_in_at: null, service_order_status: 'pending' })
const supabase = {
  auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
  rpc: async () => ({ data: null }),
  storage: { from: () => ({ upload: async (path: string) => { uploads.push(path); return { error: null } }, getPublicUrl: (path: string) => ({ data: { publicUrl: `https://files/${path}` } }) }) },
  from: () => {
    const chain: Record<string, unknown> = {}
    let isUpdate = false
    let patch: { service_order_photos?: Photo[] } = {}
    Object.assign(chain, {
      select: () => chain,
      eq: () => chain,
      update: (p: typeof patch) => { isUpdate = true; patch = p; return chain },
      maybeSingle: async () => {
        if (isUpdate) { updates += 1; if (patch.service_order_photos) stored = patch.service_order_photos; return { data: { ...row() }, error: null } }
        return { data: row(), error: null }
      },
    })
    return chain
  },
}
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => supabase }))
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => null }))

const send = async (fields: Record<string, string>, files: { field: string; name: string }[]) => {
  const { PATCH } = await import('../route')
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  for (const f of files) fd.append(f.field, new File(['x'], f.name, { type: 'image/jpeg' }))
  const res = await PATCH(new Request('http://x', { method: 'PATCH', body: fd }), { params: Promise.resolve({ id: 'u1', appointmentId: 'a1' }) })
  return { status: res.status, body: (await res.json()) as { ok?: boolean; idempotent?: boolean; error?: string; appointment?: { service_order_photos: Photo[] } } }
}

describe('PATCH service-order — fotos só-fotos e reenvio', () => {
  beforeEach(() => { stored = []; uploads.length = 0; updates = 0 })

  it('nenhuma foto enviada: erro apropriado (400)', async () => {
    const r = await send({ clientSaveId: 's1' }, [])
    expect(r.status).toBe(400)
    expect(r.body.error).toBe('Nenhuma foto para salvar.')
  })
  it('primeiro envio grava; reenvio idêntico (resposta perdida) = sucesso idempotente, sem regravar nem duplicar', async () => {
    const first = await send({ clientSaveId: 's1' }, [{ field: 'photosBefore', name: 'a.jpg' }])
    expect(first.status).toBe(200)
    expect(stored).toHaveLength(1)
    const again = await send({ clientSaveId: 's1' }, [{ field: 'photosBefore', name: 'a.jpg' }])
    expect(again.status).toBe(200)
    expect(again.body.idempotent).toBe(true)
    expect(stored).toHaveLength(1)
    expect(updates).toBe(1) // o reenvio não escreveu na ordem
    expect(new Set(uploads).size).toBe(1) // mesmo caminho de arquivo (upsert), nunca arquivo novo
  })
  it('existentes misturadas com novas: grava só as novas', async () => {
    await send({ clientSaveId: 's1' }, [{ field: 'photosBefore', name: 'a.jpg' }])
    const mixed = await send({ clientSaveId: 's1' }, [{ field: 'photosBefore', name: 'a.jpg' }, { field: 'photosBefore', name: 'b.jpg' }])
    expect(mixed.status).toBe(200)
    expect(mixed.body.idempotent).toBeUndefined()
    expect(stored).toHaveLength(2)
    expect(new Set(stored.map((p) => p.url)).size).toBe(2)
  })
})
