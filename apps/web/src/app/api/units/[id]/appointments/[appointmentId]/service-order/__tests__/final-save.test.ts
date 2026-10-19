import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Salvamento final do Sign Off (assinatura + dados) com anexos já registrados à parte (upload direto).
 * Garantias: nunca apaga mídia registrada em paralelo, não reenvia o que já está lá, mantém a assinatura obrigatória e o isolamento entre empresas.
 */
type Photo = { url: string; uploaded_at: string; kind: string }
let photos: Photo[] = []
let visible = true
let betweenReadAndUpdate: (() => void) | null = null
const uploads: string[] = []
const updates: Record<string, unknown>[] = []

const row = () => ({ id: 'a1', unit_id: 'u1', service_order_photos: photos, service_order_signature_url: null, employee_id: null, checked_in_at: null, service_order_status: 'pending' })
const supabase = {
  auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
  rpc: async () => ({ data: null }),
  storage: { from: () => ({ upload: async (path: string) => { uploads.push(path); return { error: null } }, getPublicUrl: (path: string) => ({ data: { publicUrl: `https://files/${path}` } }) }) },
  from: () => {
    const chain: Record<string, unknown> = {}
    let isUpdate = false
    let patch: Record<string, unknown> = {}
    Object.assign(chain, {
      select: () => chain,
      eq: () => chain,
      update: (p: Record<string, unknown>) => { isUpdate = true; patch = p; return chain },
      maybeSingle: async () => {
        if (isUpdate) {
          updates.push(patch)
          if (Array.isArray(patch.service_order_photos)) photos = patch.service_order_photos as Photo[]
          return { data: { ...row(), ...patch, service_order_photos: photos }, error: null }
        }
        const snapshot = visible ? { ...row(), service_order_photos: [...photos] } : null
        betweenReadAndUpdate?.() // outro envio registra uma mídia logo depois desta leitura
        return { data: snapshot, error: null }
      },
    })
    return chain
  },
}
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => supabase }))
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => null }))
vi.mock('@vercel/functions', () => ({ waitUntil: () => undefined }))

const signOff = { status: 'completed', signedBy: 'Maria Gerente', clientSaveId: 's1-final' }
const send = async (fields: Record<string, string>, files: { field: string; name: string }[] = []) => {
  const { PATCH } = await import('../route')
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  for (const f of files) fd.append(f.field, new File([new Uint8Array(32)], f.name, { type: f.field === 'signature' ? 'image/png' : 'image/jpeg' }))
  const res = await PATCH(new Request('http://x', { method: 'PATCH', body: fd }), { params: Promise.resolve({ id: 'u1', appointmentId: 'a1' }) })
  return { status: res.status, headers: res.headers, body: (await res.json()) as { ok?: boolean; error?: string; appointment?: Record<string, unknown> } }
}

describe('PATCH service-order — salvamento final do Sign Off', () => {
  beforeEach(() => {
    photos = []
    visible = true
    betweenReadAndUpdate = null
    uploads.length = 0
    updates.length = 0
  })

  it('assinado, SEM anexos novos: salva assinatura e dados e NÃO toca na lista de fotos/vídeos', async () => {
    photos = [{ url: 'https://files/u1/a1/antes-1.jpg', uploaded_at: 't', kind: 'before' }]
    const r = await send(signOff, [{ field: 'signature', name: 'assinatura.png' }])
    expect(r.status).toBe(200)
    expect(updates).toHaveLength(1)
    expect('service_order_photos' in updates[0]!).toBe(false)
    expect(updates[0]).toMatchObject({ service_order_status: 'completed', service_order_signed_by: 'Maria Gerente' })
    expect(String(updates[0]!.service_order_signature_url)).toContain('assinatura-s1-final.png')
    expect(photos).toHaveLength(1)
  })

  it('um vídeo registrado em paralelo, depois da leitura e antes da gravação, NÃO é apagado pelo Sign Off', async () => {
    photos = [{ url: 'https://files/u1/a1/antes-1.jpg', uploaded_at: 't', kind: 'before' }]
    betweenReadAndUpdate = () => {
      photos = [...photos, { url: 'https://files/u1/a1/video-1.mp4', uploaded_at: 't', kind: 'video' }]
      betweenReadAndUpdate = null
    }
    const r = await send(signOff, [{ field: 'signature', name: 'assinatura.png' }])
    expect(r.status).toBe(200)
    expect(photos.map((p) => p.kind)).toEqual(['before', 'video'])
  })

  it('com anexos já registrados: não reenvia nenhum arquivo de mídia (só a assinatura sobe)', async () => {
    photos = [
      { url: 'https://files/u1/a1/antes-1.jpg', uploaded_at: 't', kind: 'before' },
      { url: 'https://files/u1/a1/video-1.mp4', uploaded_at: 't', kind: 'video' },
    ]
    await send(signOff, [{ field: 'signature', name: 'assinatura.png' }])
    expect(uploads).toHaveLength(1)
    expect(uploads[0]).toContain('assinatura-')
  })

  it('reenvio idempotente (resposta perdida): mesmo caminho da assinatura, nenhuma foto duplicada', async () => {
    photos = [{ url: 'https://files/u1/a1/antes-1.jpg', uploaded_at: 't', kind: 'before' }]
    await send(signOff, [{ field: 'signature', name: 'assinatura.png' }])
    await send(signOff, [{ field: 'signature', name: 'assinatura.png' }])
    expect(new Set(uploads).size).toBe(1)
    expect(photos).toHaveLength(1)
  })

  it('salvar de novo sem nenhum anexo novo e sem assinatura nova (só dados) funciona', async () => {
    const r = await send({ ...signOff, status: 'quote', materialDescription: 'trocar fechadura' })
    expect(r.status).toBe(200)
    expect(updates[0]).toMatchObject({ service_order_status: 'quote' })
    expect(uploads).toHaveLength(0)
  })

  it('assinatura continua OBRIGATÓRIA para finalizar: sem ela, 400 e nada é gravado', async () => {
    const r = await send(signOff)
    expect(r.status).toBe(400)
    expect(r.body.error).toMatch(/assinatura/i)
    expect(updates).toHaveLength(0)
  })

  it('nome de quem assinou continua obrigatório', async () => {
    const r = await send({ status: 'completed', signedBy: '', clientSaveId: 's' }, [{ field: 'signature', name: 'assinatura.png' }])
    expect(r.status).toBe(400)
    expect(updates).toHaveLength(0)
  })

  it('ordem de outra empresa / sem permissão (a RLS não devolve a linha): 404, nada é enviado nem gravado', async () => {
    visible = false
    const r = await send(signOff, [{ field: 'signature', name: 'assinatura.png' }])
    expect(r.status).toBe(404)
    expect(uploads).toHaveLength(0)
    expect(updates).toHaveLength(0)
  })

  it('devolve a medição por etapa (Server-Timing) só com nomes de etapa e milissegundos', async () => {
    const r = await send(signOff, [{ field: 'signature', name: 'assinatura.png' }])
    const timing = r.headers.get('server-timing') ?? ''
    expect(timing).toMatch(/auth_body;dur=\d+/)
    expect(timing).toMatch(/read_order;dur=\d+/)
    expect(timing).toMatch(/update_order;dur=\d+/)
    expect(timing).toMatch(/total;dur=\d+/)
    expect(timing).not.toMatch(/Maria|u1|a1|assinatura/)
  })
})
