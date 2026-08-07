import { NextResponse } from 'next/server'
import { getAppUser } from '@/lib/app-user'
import { extractServiceOrderFromImage } from '@/lib/service-orders/extraction'

/**
 * Extração por IA (visão) da ordem de serviço recém-anexada — chamada
 * pelo admin logo depois do upload da imagem no Storage (ver
 * service-order-attach-modal.tsx), antes de salvar. Só sugere: o admin
 * sempre revisa/edita os campos antes de confirmar, nunca salva
 * automático. Não escreve nada no banco; se a extração falhar (sem
 * OPENAI_API_KEY, imagem ilegível, erro da OpenAI), devolve os três
 * campos como null — o fluxo principal (anexo + visualização) nunca
 * trava por causa disso.
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
  const imageUrl = (body as { imageUrl?: unknown } | null)?.imageUrl
  if (typeof imageUrl !== 'string' || !imageUrl) {
    return NextResponse.json({ error: 'Informe a URL da imagem.' }, { status: 400 })
  }

  const extraction = await extractServiceOrderFromImage(imageUrl)

  return NextResponse.json({
    summaryPt: extraction?.summaryPt ?? null,
    address: extraction?.address ?? null,
    orderNumber: extraction?.orderNumber ?? null,
  })
}
