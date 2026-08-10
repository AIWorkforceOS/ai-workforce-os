import { NextResponse } from 'next/server'
import { getAppUser } from '@/lib/app-user'
import { createServiceClient } from '@/lib/supabase/service'
import { resolveClientTargetCustomer } from '@/lib/portal-360/data'
import { buildClientOrderInsertRow, validateRequestedDate } from '@/lib/portal-360/order-request'
import { extractServiceOrderFromAttachment, isExtractableAttachment } from '@/lib/service-orders/extraction'

const FILE_MAX_BYTES = 15 * 1024 * 1024
const ACCEPTED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']

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

  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: 'Attach the service order file (PDF or photo).' }, { status: 400 })
  }
  if (!ACCEPTED_TYPES.includes(file.type) || file.size > FILE_MAX_BYTES) {
    return NextResponse.json({ error: 'The file must be a PDF, JPG, PNG or WEBP up to 15MB.' }, { status: 400 })
  }

  const todayIsoDate = new Date().toISOString().slice(0, 10)
  const dateCheck = validateRequestedDate(formData.get('requestedDate'), todayIsoDate)
  if (!dateCheck.ok) {
    return NextResponse.json({ error: dateCheck.error }, { status: 400 })
  }

  const customer = await resolveClientTargetCustomer(supabase, appUser.clientCompany)
  if (!customer) {
    return NextResponse.json(
      { error: 'No store network is linked to your account yet. Please contact your Mawi account admin.' },
      { status: 409 },
    )
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_')
  const path = `${customer.unitId}/client-pending-${crypto.randomUUID()}/${safeName}`
  const { error: uploadError } = await supabase.storage
    .from('service-orders')
    .upload(path, file, { contentType: file.type || undefined })
  if (uploadError) {
    return NextResponse.json({ error: 'Could not upload the file. Please try again.' }, { status: 500 })
  }
  const { data: publicUrlData } = supabase.storage.from('service-orders').getPublicUrl(path)
  const fileUrl = publicUrlData.publicUrl

  const extraction = isExtractableAttachment(file.name) ? await extractServiceOrderFromAttachment(fileUrl, file.name) : null

  const insertRow = buildClientOrderInsertRow({
    customer,
    requestedDate: dateCheck.date,
    timezone: customer.timezone,
    fileUrl,
    fileName: file.name,
    extraction,
  })

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
