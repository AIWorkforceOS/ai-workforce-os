import { NextResponse } from 'next/server'
import { getAppUser } from '@/lib/app-user'
import { extractServiceOrderFromAttachment, isExtractableAttachment } from '@/lib/service-orders/extraction'

/**
 * Extração por IA (visão/documento) da ordem de serviço recém-anexada
 * — chamada pelo admin logo depois do upload (imagem OU PDF) no
 * Storage (ver service-order-attach-modal.tsx), antes de salvar. Só
 * sugere: o admin sempre revisa/edita os campos antes de confirmar,
 * nunca salva automático. Não escreve nada no banco; se a extração
 * falhar (sem OPENAI_API_KEY, documento ilegível, erro da OpenAI),
 * devolve os três campos como null e `failed: true` — o modal usa isso
 * pra avisar o admin que precisa preencher manualmente, mas o fluxo
 * principal (anexo + visualização) nunca trava por causa disso.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; appointmentId: string }> }) {
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

  if (!isExtractableAttachment(fileName)) {
    return NextResponse.json({ summaryPt: null, address: null, orderNumber: null, failed: false })
  }

  const extraction = await extractServiceOrderFromAttachment(fileUrl, fileName)

  return NextResponse.json({
    summaryPt: extraction?.summaryPt ?? null,
    address: extraction?.address ?? null,
    orderNumber: extraction?.orderNumber ?? null,
    failed: extraction === null,
  })
}
