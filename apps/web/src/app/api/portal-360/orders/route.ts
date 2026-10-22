import { NextResponse } from 'next/server'
import { getAppUser } from '@/lib/app-user'
import { createServiceClient } from '@/lib/supabase/service'
import { resolveClientTargetCustomer } from '@/lib/portal-360/data'
import { buildClientOrderInsertRow, parseNewOrderFields } from '@/lib/portal-360/order-request'
import { extractServiceOrderFromAttachment, isExtractableAttachment } from '@/lib/service-orders/extraction'

const FILE_MAX_BYTES = 15 * 1024 * 1024
const ACCEPTED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const PHOTO_MAX_BYTES = 10 * 1024 * 1024
const MAX_PHOTOS = 10

/**
 * Cria um pedido novo vindo do Portal 360 — a 360 anexa a ordem e
 * escolhe só o DIA desejado; profissional e horário exato continuam
 * 100% com o admin da Mawi (ver migration 061). Nunca usa o client
 * autenticado da sessão do usuário (o role 'client' tem org_id NULL
 * em public.users de propósito, então não teria RLS pra nada mesmo);
 * toda a escrita passa pelo client de service role, com a autorização
 * de verdade sendo o `clientCompany` explícito checado abaixo — mesma
 * cautela extra pedida pelo dono do produto para este primeiro login
 * de alguém de fora da empresa.
 */
export async function POST(request: Request) {
  const appUser = await getAppUser()
  if (!appUser || appUser.role !== 'client' || !appUser.clientCompany) {
    return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
  }

  const supabase = createServiceClient()
  if (!supabase) {
    return NextResponse.json({ error: 'Service temporarily unavailable.' }, { status: 503 })
  }

  const formData = await request.formData().catch(() => null)
  if (!formData) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  // O arquivo da ordem agora é opcional: o cliente pode escrever/colar a descrição. Precisa de um dos dois.
  const rawFile = formData.get('file')
  const file = rawFile instanceof File && rawFile.size > 0 ? rawFile : null
  if (file && (!ACCEPTED_TYPES.includes(file.type) || file.size > FILE_MAX_BYTES)) {
    return NextResponse.json({ error: 'The file must be a PDF, JPG, PNG or WEBP up to 15MB.' }, { status: 400 })
  }
  const photos = formData.getAll('photos').filter((p): p is File => p instanceof File && p.size > 0)
  if (photos.length > MAX_PHOTOS) return NextResponse.json({ error: `You can attach up to ${MAX_PHOTOS} photos.` }, { status: 400 })
  if (photos.some((p) => !PHOTO_TYPES.includes(p.type) || p.size > PHOTO_MAX_BYTES)) {
    return NextResponse.json({ error: 'Photos must be JPG, PNG or WEBP up to 10MB each.' }, { status: 400 })
  }

  const parsed = parseNewOrderFields((key) => formData.get(key), new Date().toISOString().slice(0, 10), Boolean(file))
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const customer = await resolveClientTargetCustomer(supabase, appUser.clientCompany)
  if (!customer) {
    return NextResponse.json(
      { error: 'No store network is linked to your account yet. Please contact your Mawi account admin.' },
      { status: 409 },
    )
  }

  const folder = `${customer.unitId}/client-pending-${crypto.randomUUID()}`
  const safe = (name: string) => name.replace(/[^a-zA-Z0-9.\-_]/g, '_')
  async function upload(f: File, name: string): Promise<string | null> {
    const path = `${folder}/${name}`
    const { error } = await supabase!.storage.from('service-orders').upload(path, f, { contentType: f.type || undefined })
    return error ? null : supabase!.storage.from('service-orders').getPublicUrl(path).data.publicUrl
  }

  let fileInfo: { url: string; name: string } | null = null
  if (file) {
    const url = await upload(file, safe(file.name))
    if (!url) return NextResponse.json({ error: 'Could not upload the file. Please try again.' }, { status: 500 })
    fileInfo = { url, name: file.name }
  }
  const photoUrls: string[] = []
  for (const [i, photo] of photos.entries()) {
    const url = await upload(photo, `photo-${i + 1}-${safe(photo.name)}`)
    if (!url) return NextResponse.json({ error: 'Could not upload a photo. Please try again.' }, { status: 500 })
    photoUrls.push(url)
  }

  const extraction = file && isExtractableAttachment(file.name) && fileInfo ? await extractServiceOrderFromAttachment(fileInfo.url, file.name) : null

  const insertRow = buildClientOrderInsertRow({ customer, fields: parsed.value, timezone: customer.timezone, file: fileInfo, photoUrls, extraction })

  const { data: created, error: insertError } = await supabase
    .from('appointments')
    .insert(insertRow)
    .select('id')
    .single()

  if (insertError || !created) {
    return NextResponse.json({ error: 'Could not submit the order. Please try again.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, id: (created as { id: string }).id })
}
