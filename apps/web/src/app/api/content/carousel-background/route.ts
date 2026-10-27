import { NextResponse } from 'next/server'
import { getAppUser } from '@/lib/app-user'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

const TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }
const MAX_BYTES = 8 * 1024 * 1024

/** Envia uma foto real da empresa para usar de fundo de um slide. Devolve a URL pública (bucket content-media). Só administradores. */
export async function POST(request: Request) {
  const actor = await getAppUser()
  if (!actor) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  if (actor.role !== 'admin' && actor.role !== 'super_admin') return NextResponse.json({ error: 'Somente administradores enviam imagens.' }, { status: 403 })

  const form = await request.formData().catch(() => null)
  const unitId = form?.get('unit_id')
  const file = form?.get('file')
  if (typeof unitId !== 'string' || !(file instanceof File)) return NextResponse.json({ error: 'Envie unit_id e file.' }, { status: 400 })
  const ext = TYPES[file.type]
  if (!ext) return NextResponse.json({ error: 'Use uma imagem PNG, JPG ou WebP.' }, { status: 415 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'Imagem grande demais (máx. 8 MB).' }, { status: 413 })

  const supabase = await createClient()
  const { data: unit } = await supabase.from('units').select('id').eq('id', unitId).maybeSingle()
  if (!unit) return NextResponse.json({ error: 'Unidade não encontrada ou sem permissão.' }, { status: 404 })

  const service = createServiceClient()
  if (!service) return NextResponse.json({ error: 'Serviço não configurado (service role).' }, { status: 500 })
  const path = `${unitId}/bg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const { error } = await service.storage.from('content-media').upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false })
  if (error) return NextResponse.json({ error: 'Não foi possível enviar a imagem.' }, { status: 502 })
  return NextResponse.json({ url: service.storage.from('content-media').getPublicUrl(path).data.publicUrl })
}
