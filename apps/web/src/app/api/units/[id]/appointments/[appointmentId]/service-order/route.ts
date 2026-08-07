import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { PortalServiceOrderPhoto } from '@/lib/portal-funcionario/data'
import { buildServiceOrderUpdatePayload } from '@/lib/service-orders/finalize'

type AppointmentRow = {
  id: string
  unit_id: string
  service_order_photos: PortalServiceOrderPhoto[] | null
  service_order_signature_url: string | null
}

/**
 * Finaliza (ou cota) a ordem de serviço anexada ao agendamento —
 * chamada pelo técnico no Portal do Funcionário (ver
 * service-order-panel.tsx). Roda com o client autenticado do próprio
 * usuário (cookies da sessão), então tanto o upload das fotos quanto o
 * UPDATE em `appointments` passam pela RLS de verdade: a policy nova
 * appointments_employee_service_order_update (migration 056) só deixa
 * o técnico mexer na própria linha, e o trigger
 * appointments_guard_employee_write rejeita qualquer coluna fora do
 * fluxo de execução da ordem — mesmo que este endpoint tentasse mandar
 * mais do que devia, o banco barra.
 *
 * Pedido explícito do dono do produto: nada disso pode ir direto do
 * client pro Storage+DB sem essa validação — por isso é uma rota de
 * API (não um .update()/.upload() direto no componente), diferente do
 * fluxo do admin (que já tem escrita ampla via RLS de org_admin).
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; appointmentId: string }> },
) {
  const { id: unitId, appointmentId } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  }

  const formData = await request.formData().catch(() => null)
  if (!formData) {
    return NextResponse.json({ error: 'Requisição inválida.' }, { status: 400 })
  }

  const finalizeInput = {
    status: formData.get('status'),
    signedBy: formData.get('signedBy'),
    partPurchaseLink: formData.get('partPurchaseLink'),
    materialDescription: formData.get('materialDescription'),
    materialValue: formData.get('materialValue'),
    hoursNeeded: formData.get('hoursNeeded'),
  }
  // Validação cedo (antes de subir fotos) — evita gastar upload num payload que já vai ser rejeitado.
  const earlyCheck = buildServiceOrderUpdatePayload(finalizeInput, [], [])
  if (!earlyCheck.ok) {
    return NextResponse.json({ error: earlyCheck.error }, { status: 400 })
  }

  // A linha só existe pra quem a RLS deixa ver (o próprio técnico, via
  // appointments_select + current_app_employee_id — migration 053; ou
  // um admin da org) — 404 cobre "não existe" e "não é seu" igualmente,
  // sem vazar qual dos dois é o caso.
  const { data: existing } = await supabase
    .from('appointments')
    .select('id, unit_id, service_order_photos, service_order_signature_url')
    .eq('id', appointmentId)
    .eq('unit_id', unitId)
    .maybeSingle()
  const appointment = existing as AppointmentRow | null
  if (!appointment) {
    return NextResponse.json({ error: 'Agendamento não encontrado.' }, { status: 404 })
  }

  const photoFiles = formData.getAll('photos').filter((entry): entry is File => entry instanceof File && entry.size > 0)
  const materialPhotoFiles = formData
    .getAll('materialPhotos')
    .filter((entry): entry is File => entry instanceof File && entry.size > 0)

  /** Sobe uma lista de fotos pro bucket service-orders e devolve as entradas já marcadas com `kind` — usado tanto pras fotos do atendimento quanto pras notas fiscais de compra de material. */
  async function uploadPhotos(
    files: File[],
    prefix: string,
    kind: PortalServiceOrderPhoto['kind'],
  ): Promise<PortalServiceOrderPhoto[] | { error: string }> {
    const uploaded: PortalServiceOrderPhoto[] = []
    for (const [index, file] of files.entries()) {
      const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_')
      const path = `${unitId}/${appointmentId}/${prefix}-${Date.now()}-${index}-${safeName}`
      const { error: uploadError } = await supabase.storage
        .from('service-orders')
        .upload(path, file, { contentType: file.type || undefined })
      if (uploadError) {
        return { error: `Não foi possível enviar a foto "${file.name}".` }
      }
      const { data: publicUrl } = supabase.storage.from('service-orders').getPublicUrl(path)
      uploaded.push({ url: publicUrl.publicUrl, uploaded_at: new Date().toISOString(), kind })
    }
    return uploaded
  }

  const uploadedServicePhotos = await uploadPhotos(photoFiles, 'foto', 'service')
  if ('error' in uploadedServicePhotos) {
    return NextResponse.json({ error: uploadedServicePhotos.error }, { status: 500 })
  }
  const uploadedMaterialPhotos = await uploadPhotos(materialPhotoFiles, 'nota-fiscal', 'material_invoice')
  if ('error' in uploadedMaterialPhotos) {
    return NextResponse.json({ error: uploadedMaterialPhotos.error }, { status: 500 })
  }
  const uploadedPhotos: PortalServiceOrderPhoto[] = [...uploadedServicePhotos, ...uploadedMaterialPhotos]

  const signatureFile = formData.get('signature')
  let uploadedSignatureUrl: string | null = null
  if (signatureFile instanceof File && signatureFile.size > 0) {
    const path = `${unitId}/${appointmentId}/assinatura-${Date.now()}.png`
    const { error: signatureUploadError } = await supabase.storage
      .from('service-orders')
      .upload(path, signatureFile, { contentType: signatureFile.type || 'image/png' })
    if (signatureUploadError) {
      return NextResponse.json({ error: 'Não foi possível enviar a assinatura.' }, { status: 500 })
    }
    const { data: signaturePublicUrl } = supabase.storage.from('service-orders').getPublicUrl(path)
    uploadedSignatureUrl = signaturePublicUrl.publicUrl
  }

  const finalCheck = buildServiceOrderUpdatePayload(
    finalizeInput,
    appointment.service_order_photos ?? [],
    uploadedPhotos,
    appointment.service_order_signature_url ?? null,
    uploadedSignatureUrl,
  )
  if (!finalCheck.ok) {
    return NextResponse.json({ error: finalCheck.error }, { status: 400 })
  }

  const { data: updated, error: updateError } = await supabase
    .from('appointments')
    .update(finalCheck.payload)
    .eq('id', appointmentId)
    .select(
      'id, service_order_status, service_order_signed_by, service_order_signed_at, service_order_signature_url, service_order_part_purchase_link, service_order_material_description, service_order_material_value, service_order_hours_needed, service_order_photos',
    )
    .maybeSingle()

  if (updateError) {
    return NextResponse.json({ error: updateError.message || 'Não foi possível salvar a ordem de serviço.' }, { status: 400 })
  }
  if (!updated) {
    return NextResponse.json({ error: 'Sem permissão para atualizar esta ordem de serviço.' }, { status: 403 })
  }

  return NextResponse.json({ ok: true, appointment: updated })
}
