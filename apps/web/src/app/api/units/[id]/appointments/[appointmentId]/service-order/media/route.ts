import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isAllowedContentType, isMediaUrlOfAppointment, mediaSizeLimit, validateMediaItems } from '@/lib/service-orders/media'

/**
 * Registra na ordem fotos/vídeos que o aparelho JÁ enviou direto pro
 * Storage (upload direto: o corpo de uma função da Vercel é limitado a
 * ~4,5MB, então foto/vídeo nunca passam por aqui). Antes de registrar,
 * CONFERE que cada arquivo existe de verdade no bucket, com tipo e
 * tamanho aceitos — a mídia só conta como salva depois disso (pedido do
 * Vinicius: nada de considerar salvo só porque aparece na tela).
 *
 * Idempotente: registrar o mesmo arquivo de novo não duplica (dedupe por
 * url dentro do UPDATE atômico da função append_service_order_media,
 * migration 088). Roda com o client do próprio usuário: RLS e trigger de
 * funcionário continuam valendo.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; appointmentId: string }> }) {
  const { id: unitId, appointmentId } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const validation = validateMediaItems((body as { items?: unknown } | null)?.items, unitId, appointmentId)
  if (!validation.ok) return NextResponse.json({ error: validation.error }, { status: 400 })

  // A ordem e a conferência de cada arquivo no Storage são independentes: tudo em paralelo (antes: uma ida por arquivo, em fila).
  const bucket = supabase.storage.from('service-orders')
  const [{ data: existing }, infos] = await Promise.all([
    supabase.from('appointments').select('id').eq('id', appointmentId).eq('unit_id', unitId).maybeSingle(),
    Promise.all(validation.items.map((item) => bucket.info(item.path))),
  ])
  if (!existing) return NextResponse.json({ error: 'Agendamento não encontrado.' }, { status: 404 })

  const entries: { url: string; uploaded_at: string; kind: string }[] = []
  // Os resultados são avaliados na ordem da lista: o 1º problema encontrado é o mesmo de antes e as fotos mantêm a ordem.
  for (const [index, item] of validation.items.entries()) {
    const { data: info, error: infoError } = infos[index]!
    if (infoError || !info) {
      return NextResponse.json({ error: 'Arquivo ainda não está no servidor.', path: item.path }, { status: 422 })
    }
    const size = Number(info.size ?? 0)
    if (size <= 0) return NextResponse.json({ error: 'Arquivo vazio no servidor.', path: item.path }, { status: 422 })
    if (size > mediaSizeLimit(item.kind)) return NextResponse.json({ error: 'Arquivo grande demais.', path: item.path }, { status: 413 })
    if (!isAllowedContentType(item.kind, info.contentType)) {
      return NextResponse.json({ error: 'Tipo de arquivo não aceito.', path: item.path }, { status: 415 })
    }
    entries.push({ url: bucket.getPublicUrl(item.path).data.publicUrl, uploaded_at: new Date().toISOString(), kind: item.kind })
  }

  const { data, error } = await supabase.rpc('append_service_order_media', { p_appointment_id: appointmentId, p_items: entries })
  if (error) return NextResponse.json({ error: error.message || 'Não foi possível registrar a mídia.' }, { status: 400 })
  if (!data) return NextResponse.json({ error: 'Sem permissão para atualizar esta ordem de serviço.' }, { status: 403 })

  return NextResponse.json({ ok: true, photos: data })
}

/**
 * Exclui uma foto/vídeo da ordem: some do app, do PDF e do relatório
 * fotográfico. O arquivo continua no Storage (nada é apagado de vez —
 * recuperável pelo caminho). Atômico via remove_service_order_media
 * (migration 089); roda com o client do usuário, então RLS e trigger valem.
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; appointmentId: string }> }) {
  const { id: unitId, appointmentId } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  const body = (await request.json().catch(() => null)) as { url?: unknown } | null
  if (!isMediaUrlOfAppointment(body?.url, unitId, appointmentId)) {
    return NextResponse.json({ error: 'Arquivo não pertence a esta ordem.' }, { status: 400 })
  }

  const { data, error } = await supabase.rpc('remove_service_order_media', { p_appointment_id: appointmentId, p_url: body!.url as string })
  if (error) return NextResponse.json({ error: error.message || 'Não foi possível excluir.' }, { status: 400 })
  if (!data) return NextResponse.json({ error: 'Sem permissão para alterar esta ordem de serviço.' }, { status: 403 })

  return NextResponse.json({ ok: true, photos: data })
}
