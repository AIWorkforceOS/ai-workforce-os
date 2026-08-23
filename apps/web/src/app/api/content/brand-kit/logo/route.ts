import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { extractPaletteFromLogo, removeSolidBackground } from '@/lib/content/logo-processing'

export const maxDuration = 30

const FILE_MAX_BYTES = 5 * 1024 * 1024

/**
 * Upload do logo da marca (pedido do Vinicius, 2026-08-23): diferente do
 * resto do brand kit (que grava direto do navegador), o logo passa por
 * processamento server-side (sharp só roda em Node) — remove o fundo
 * sólido e já extrai a paleta de cores dominante do próprio desenho, pra
 * pré-preencher cor primária/secundária sem o cliente precisar escolher
 * na mão. A sessão só confirma acesso à unidade; quem sobe pro Storage é
 * o service role (mesmo padrão das outras rotas de conteúdo).
 *
 * POST multipart/form-data { unit_id, file }
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  const form = await request.formData()
  const unitId = form.get('unit_id')
  const file = form.get('file')
  if (typeof unitId !== 'string' || !unitId) return NextResponse.json({ error: 'unit_id é obrigatório.' }, { status: 400 })
  if (!(file instanceof File)) return NextResponse.json({ error: 'Arquivo do logo é obrigatório.' }, { status: 400 })
  if (file.size > FILE_MAX_BYTES) return NextResponse.json({ error: 'Logo muito grande — envie um arquivo de até 5MB.' }, { status: 400 })

  const { data: unit } = await supabase.from('units').select('id').eq('id', unitId).maybeSingle()
  if (!unit) return NextResponse.json({ error: 'Unidade não encontrada ou sem permissão.' }, { status: 404 })

  const service = createServiceClient()
  if (!service) return NextResponse.json({ error: 'Serviço não configurado (service role).' }, { status: 500 })

  let processed: Buffer
  let palette: { primary: string; secondary: string | null }
  try {
    const original = Buffer.from(await file.arrayBuffer())
    processed = await removeSolidBackground(original)
    palette = await extractPaletteFromLogo(processed)
  } catch {
    return NextResponse.json({ error: 'Não foi possível processar essa imagem — tente outro arquivo (PNG ou JPG).' }, { status: 422 })
  }

  const path = `${unitId}/brand/logo-${Date.now()}.png`
  const { error: uploadError } = await service.storage.from('content-media').upload(path, processed, { contentType: 'image/png', upsert: false })
  if (uploadError) return NextResponse.json({ error: 'Não foi possível enviar o logo. Tente de novo.' }, { status: 500 })

  const { data } = service.storage.from('content-media').getPublicUrl(path)
  return NextResponse.json({ logo_url: data.publicUrl, primary_color: palette.primary, secondary_color: palette.secondary })
}
