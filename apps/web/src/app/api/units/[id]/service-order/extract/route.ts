import { NextResponse } from 'next/server'
import { getAppUser } from '@/lib/app-user'
import { extractServiceOrderFromAttachment, isExtractableAttachment } from '@/lib/service-orders/extraction'

/**
 * Mesma extração de /api/units/[id]/appointments/[appointmentId]/service-order/extract,
 * mas sem depender de um agendamento já existente — usada pelo anexo
 * inline de ordem de serviço dentro do formulário de "novo
 * agendamento" (AppointmentFormModal, mode create), onde o admin
 * anexa e extrai ANTES de o agendamento existir. O handler original
 * nunca usava appointmentId de fato (só id da unidade, pra
 * autorização); esta rota é a versão limpa disso.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const appUser = await getAppUser()
  if (!appUser) {
    return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  }
  if (!appUser.isSuperAdmin && appUser.role !== 'admin') {
    return NextResponse.json({ error: 'Sem permissão para extrair dados da ordem de serviço.' }, { status: 403 })
  }
  if (appUser.unitId && appUser.unitId !== id) {
    return NextResponse.json({ error: 'Sem permissão para esta unidade.' }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  const fileUrl = (body as { fileUrl?: unknown } | null)?.fileUrl
  const fileName = (body as { fileName?: unknown } | null)?.fileName
  if (typeof fileUrl !== 'string' || !fileUrl || typeof fileName !== 'string' || !fileName) {
    return NextResponse.json({ error: 'Informe a URL e o nome do arquivo.' }, { status: 400 })
  }

  const empty = {
    summaryPt: null,
    scopeEn: null,
    address: null,
    orderNumber: null,
    clientPo: null,
    priority: null,
    orderType: null,
    ivrPin: null,
    locationName: null,
    locationPhone: null,
    issuerName: null,
    issuerEmail: null,
  }

  if (!isExtractableAttachment(fileName)) {
    return NextResponse.json({ ...empty, failed: false })
  }

  const extraction = await extractServiceOrderFromAttachment(fileUrl, fileName)

  return NextResponse.json({
    summaryPt: extraction?.summaryPt ?? null,
    scopeEn: extraction?.scopeEn ?? null,
    address: extraction?.address ?? null,
    orderNumber: extraction?.orderNumber ?? null,
    clientPo: extraction?.clientPo ?? null,
    priority: extraction?.priority ?? null,
    orderType: extraction?.orderType ?? null,
    ivrPin: extraction?.ivrPin ?? null,
    locationName: extraction?.locationName ?? null,
    locationPhone: extraction?.locationPhone ?? null,
    issuerName: extraction?.issuerName ?? null,
    issuerEmail: extraction?.issuerEmail ?? null,
    failed: extraction === null,
  })
}
