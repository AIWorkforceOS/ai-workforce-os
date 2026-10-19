import { NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import type { PortalServiceOrderPhoto } from '@/lib/portal-funcionario/data'
import { buildServiceOrderUpdatePayload, buildPhotosOnlyUpdatePayload, isIdempotentPhotoReplay } from '@/lib/service-orders/finalize'
import { autoGenerateQuoteOnSave } from '@/lib/service-orders/quote-composer'
import { canFinalizeOrder } from '@/lib/portal-funcionario/field-time'

type AppointmentRow = {
  id: string
  unit_id: string
  service_order_photos: PortalServiceOrderPhoto[] | null
  service_order_signature_url: string | null
  employee_id: string | null
  checked_in_at: string | null
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
  // Medição por etapa (cabeçalho Server-Timing): só nomes de etapa e milissegundos — nada de dados da ordem.
  const startedAt = performance.now()
  const marks: string[] = []
  const mark = (name: string, since: number) => marks.push(`${name};dur=${Math.round(performance.now() - since)}`)
  const timed = (body: Record<string, unknown>, init: { status?: number } = {}) => {
    marks.push(`total;dur=${Math.round(performance.now() - startedAt)}`)
    return NextResponse.json(body, { ...init, headers: { 'Server-Timing': marks.join(', ') } })
  }
  const supabase = await createClient()

  // Autenticação e leitura do corpo são independentes: rodam juntas.
  let t = performance.now()
  const [authResult, formData] = await Promise.all([supabase.auth.getUser(), request.formData().catch(() => null)])
  mark('auth_body', t)
  if (!authResult.data.user) {
    return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  }
  if (!formData) {
    return NextResponse.json({ error: 'Requisição inválida.' }, { status: 400 })
  }

  // Sem `status` no FormData = salvamento só de fotos (botão "Salvar fotos
  // agora", separado do formulário de finalizar/cotar) — pedido real
  // (2026-09-15): o técnico tira foto "antes" ao chegar, mas só decide
  // Finalizado/Cotação e pega assinatura no FIM. Photos-only pula toda a
  // validação de status/assinatura, que não se aplica aqui.
  const photosOnly = formData.get('status') === null

  const finalizeInput = {
    status: formData.get('status'),
    signedBy: formData.get('signedBy'),
    partPurchaseLink: formData.get('partPurchaseLink'),
    materialDescription: formData.get('materialDescription'),
    materialValue: formData.get('materialValue'),
    hoursNeeded: formData.get('hoursNeeded'),
  }
  // Validação cedo (antes de subir fotos) — evita gastar upload num payload que já vai ser rejeitado.
  if (!photosOnly) {
    const earlyCheck = buildServiceOrderUpdatePayload(finalizeInput, [], [])
    if (!earlyCheck.ok) {
      return NextResponse.json({ error: earlyCheck.error }, { status: 400 })
    }
  }

  // A linha só existe pra quem a RLS deixa ver (o próprio técnico, via
  // appointments_select + current_app_employee_id — migration 053; ou
  // um admin da org) — 404 cobre "não existe" e "não é seu" igualmente,
  // sem vazar qual dos dois é o caso.
  // A leitura da ordem e "quem sou eu" (técnico) são independentes: uma ida só ao banco em vez de duas em fila.
  t = performance.now()
  const [{ data: existing }, meResult] = await Promise.all([
    supabase
      .from('appointments')
      .select('id, unit_id, service_order_photos, service_order_signature_url, employee_id, checked_in_at')
      .eq('id', appointmentId)
      .eq('unit_id', unitId)
      .maybeSingle(),
    photosOnly ? Promise.resolve({ data: null as string | null }) : supabase.rpc('current_app_employee_id'),
  ])
  mark('read_order', t)
  const appointment = existing as AppointmentRow | null
  if (!appointment) {
    return NextResponse.json({ error: 'Agendamento não encontrado.' }, { status: 404 })
  }

  // Check-in com GPS obrigatório (admin marca por técnico): quem é o técnico da ordem não fecha sem ter feito o check-in.
  // Só vale para o próprio técnico — o admin editando a ordem pelo painel não é barrado.
  let isAssignedEmployee = false
  if (!photosOnly && appointment.employee_id) {
    const me = meResult.data
    isAssignedEmployee = me === appointment.employee_id
    if (isAssignedEmployee) {
      const { data: emp } = await supabase.from('employees').select('requires_checkin').eq('id', appointment.employee_id).maybeSingle()
      const requires = Boolean((emp as { requires_checkin?: boolean | null } | null)?.requires_checkin)
      if (!canFinalizeOrder(requires, appointment.checked_in_at)) {
        return NextResponse.json({ error: 'Faça o check-in (com o GPS) antes de finalizar a ordem.' }, { status: 409 })
      }
    }
  }

  // Idempotência de reenvio vindo da fila offline: mesmo clientSaveId = mesmo caminho de
  // arquivo (upsert), então repetir uma requisição nunca duplica foto/assinatura.
  const rawSaveId = formData.get('clientSaveId')
  const clientSaveId = typeof rawSaveId === 'string' ? rawSaveId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80) : ''

  const beforePhotoFiles = formData
    .getAll('photosBefore')
    .filter((entry): entry is File => entry instanceof File && entry.size > 0)
  const afterPhotoFiles = formData
    .getAll('photosAfter')
    .filter((entry): entry is File => entry instanceof File && entry.size > 0)
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
      const path = clientSaveId
        ? `${unitId}/${appointmentId}/${prefix}-${clientSaveId}-${index}-${safeName}`
        : `${unitId}/${appointmentId}/${prefix}-${Date.now()}-${index}-${safeName}`
      const { error: uploadError } = await supabase.storage
        .from('service-orders')
        .upload(path, file, { contentType: file.type || undefined, upsert: Boolean(clientSaveId) })
      if (uploadError) {
        return { error: `Não foi possível enviar a foto "${file.name}".` }
      }
      const { data: publicUrl } = supabase.storage.from('service-orders').getPublicUrl(path)
      uploaded.push({ url: publicUrl.publicUrl, uploaded_at: new Date().toISOString(), kind })
    }
    return uploaded
  }

  t = performance.now()
  const uploadedBeforePhotos = await uploadPhotos(beforePhotoFiles, 'antes', 'before')
  if ('error' in uploadedBeforePhotos) {
    return NextResponse.json({ error: uploadedBeforePhotos.error }, { status: 500 })
  }
  const uploadedAfterPhotos = await uploadPhotos(afterPhotoFiles, 'depois', 'after')
  if ('error' in uploadedAfterPhotos) {
    return NextResponse.json({ error: uploadedAfterPhotos.error }, { status: 500 })
  }
  const uploadedMaterialPhotos = await uploadPhotos(materialPhotoFiles, 'nota-fiscal', 'material_invoice')
  if ('error' in uploadedMaterialPhotos) {
    return NextResponse.json({ error: uploadedMaterialPhotos.error }, { status: 500 })
  }
  mark('upload_files', t)
  const knownUrls = new Set((appointment.service_order_photos ?? []).map((photo) => photo.url))
  const uploadedPhotos: PortalServiceOrderPhoto[] = [...uploadedBeforePhotos, ...uploadedAfterPhotos, ...uploadedMaterialPhotos].filter(
    (photo) => !knownUrls.has(photo.url),
  )

  // Reenvio idempotente (fila offline): arquivos chegaram, mas todos já estão na ordem ⇒ sucesso com o estado atual, sem regravar nada.
  const filesSent = beforePhotoFiles.length + afterPhotoFiles.length + materialPhotoFiles.length
  if (isIdempotentPhotoReplay({ photosOnly, filesSent, newPhotos: uploadedPhotos.length })) {
    const { data: current } = await supabase
      .from('appointments')
      .select(
        'id, service_order_status, service_order_signed_by, service_order_signed_at, service_order_signature_url, service_order_part_purchase_link, service_order_material_description, service_order_material_value, service_order_hours_needed, service_order_photos',
      )
      .eq('id', appointmentId)
      .maybeSingle()
    return NextResponse.json({ ok: true, idempotent: true, appointment: current })
  }

  const signatureFile = formData.get('signature')
  let uploadedSignatureUrl: string | null = null
  t = performance.now()
  if (signatureFile instanceof File && signatureFile.size > 0) {
    const path = `${unitId}/${appointmentId}/assinatura-${clientSaveId || Date.now()}.png`
    const { error: signatureUploadError } = await supabase.storage
      .from('service-orders')
      .upload(path, signatureFile, { contentType: signatureFile.type || 'image/png', upsert: Boolean(clientSaveId) })
    if (signatureUploadError) {
      return NextResponse.json({ error: 'Não foi possível enviar a assinatura.' }, { status: 500 })
    }
    const { data: signaturePublicUrl } = supabase.storage.from('service-orders').getPublicUrl(path)
    uploadedSignatureUrl = signaturePublicUrl.publicUrl
  }

  mark('signature', t)
  const finalCheck = photosOnly
    ? buildPhotosOnlyUpdatePayload(appointment.service_order_photos ?? [], uploadedPhotos)
    : buildServiceOrderUpdatePayload(
        finalizeInput,
        appointment.service_order_photos ?? [],
        uploadedPhotos,
        appointment.service_order_signature_url ?? null,
        uploadedSignatureUrl,
      )
  if (!finalCheck.ok) {
    return NextResponse.json({ error: finalCheck.error }, { status: 400 })
  }

  t = performance.now()
  const { data: updated, error: updateError } = await supabase
    .from('appointments')
    .update(finalCheck.payload)
    .eq('id', appointmentId)
    .select(
      'id, service_order_status, service_order_signed_by, service_order_signed_at, service_order_signature_url, service_order_part_purchase_link, service_order_material_description, service_order_material_value, service_order_hours_needed, service_order_photos',
    )
    .maybeSingle()

  mark('update_order', t)
  if (updateError) {
    return NextResponse.json({ error: updateError.message || 'Não foi possível salvar a ordem de serviço.' }, { status: 400 })
  }
  if (!updated) {
    return NextResponse.json({ error: 'Sem permissão para atualizar esta ordem de serviço.' }, { status: 403 })
  }

  // Fim do tempo de serviço: assinatura + salvar. Só o técnico da ordem, e só se a ordem ficou assinada.
  const endedAt = formData.get('endedAt')
  if (!photosOnly && isAssignedEmployee && typeof endedAt === 'string' && updated.service_order_signature_url && updated.service_order_signed_by) {
    const num = (key: string) => {
      const v = Number(formData.get(key))
      return formData.get(key) !== null && Number.isFinite(v) ? v : null
    }
    t = performance.now()
    const { error: finishError } = await supabase.rpc('record_appointment_event', {
      p_appointment_id: appointmentId,
      p_type: 'finish',
      p_at: Number.isNaN(Date.parse(endedAt)) ? null : endedAt,
      p_lat: num('endLat'),
      p_lng: num('endLng'),
      p_accuracy: num('endAcc'),
    })
    mark('finish_event', t)
    if (finishError) console.error('[service-order] fim do serviço não registrado', finishError.message)
  }

  // A descrição de cotação por IA (só para status "Cotação") é um extra: a ordem já está salva. Roda DEPOIS da resposta (sem segurar o técnico);
  // se o ambiente não suportar, roda antes de responder, como sempre foi.
  const service = createServiceClient()
  if (service && updated.service_order_status === 'quote') {
    const job = autoGenerateQuoteOnSave(service, appointmentId, updated).catch((error) => console.error('[service-order] cotação automática falhou', error instanceof Error ? error.message : error))
    try {
      waitUntil(job)
    } catch {
      await job
    }
  }

  return timed({ ok: true, appointment: updated })
}
