import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

const MAX_BYTES = 8 * 1024 * 1024
const TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

export async function POST(request: Request) {
  const session = await createClient()
  const { data: { user } } = await session.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  const form = await request.formData()
  const unitId = String(form.get('unit_id') || '')
  const before = form.get('before')
  const after = form.get('after')
  const description = String(form.get('description') || '').trim().slice(0, 500)
  if (!unitId || !(before instanceof File) || !(after instanceof File)) return NextResponse.json({ error: 'Envie as duas fotos: antes e depois.' }, { status: 400 })
  for (const file of [before, after]) {
    if (!TYPES.has(file.type) || file.size > MAX_BYTES) return NextResponse.json({ error: 'Use PNG, JPG ou WebP de até 8 MB por foto.' }, { status: 400 })
  }
  const { data: unit } = await session.from('units').select('id').eq('id', unitId).maybeSingle()
  if (!unit) return NextResponse.json({ error: 'Unidade não encontrada ou sem permissão.' }, { status: 404 })
  const service = createServiceClient()
  if (!service) return NextResponse.json({ error: 'Serviço de armazenamento não configurado.' }, { status: 500 })
  const { data: config } = await service.from('agent_configs').select('id, business_profile').eq('unit_id', unitId).eq('agent_type', 'content_specialist').maybeSingle()
  if (!config) return NextResponse.json({ error: 'Gestor de Mídias não encontrado nesta unidade.' }, { status: 404 })
  const pairId = randomUUID()
  const upload = async (file: File, kind: 'before' | 'after') => {
    const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
    const path = `${unitId}/brand-assets/${pairId}-${kind}.${ext}`
    const { error } = await service.storage.from('content-media').upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false })
    if (error) throw new Error(error.message)
    return service.storage.from('content-media').getPublicUrl(path).data.publicUrl
  }
  try {
    const [beforeUrl, afterUrl] = await Promise.all([upload(before, 'before'), upload(after, 'after')])
    const profile = (config.business_profile ?? {}) as Record<string, unknown>
    const current = Array.isArray(profile.before_after_pairs) ? profile.before_after_pairs.slice(0, 29) : []
    const pair = { id: pairId, before_url: beforeUrl, after_url: afterUrl, description, created_at: new Date().toISOString() }
    const { error } = await service.from('agent_configs').update({ business_profile: { ...profile, before_after_pairs: [pair, ...current] } }).eq('id', config.id)
    if (error) throw new Error(error.message)
    return NextResponse.json({ pair })
  } catch (error) {
    return NextResponse.json({ error: `Não foi possível salvar o par: ${error instanceof Error ? error.message : String(error)}` }, { status: 500 })
  }
}
