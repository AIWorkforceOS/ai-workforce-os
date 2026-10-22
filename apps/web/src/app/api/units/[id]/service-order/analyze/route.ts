import { NextResponse } from 'next/server'
import { getAppUser } from '@/lib/app-user'
import { extractServiceOrderFromAttachment, isExtractableAttachment } from '@/lib/service-orders/extraction'
import { analyzeOrderDemand } from '@/lib/service-orders/demand-analysis'

export const maxDuration = 60

/**
 * "Analisar com IA" da ordem anexada pelo administrador: lê o PDF/foto (extração já existente) e/ou a descrição colada e devolve os campos da ordem
 * mais a análise (demanda, materiais prováveis, ideia de escopo). Só roda quando o administrador clica; não grava nada no banco. Falha da IA nunca trava:
 * devolve tudo vazio com failed: true e o administrador preenche à mão.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const appUser = await getAppUser()
  if (!appUser) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  if (!appUser.isSuperAdmin && appUser.role !== 'admin') return NextResponse.json({ error: 'Sem permissão.' }, { status: 403 })
  if (appUser.unitId && appUser.unitId !== id) return NextResponse.json({ error: 'Sem permissão para esta unidade.' }, { status: 403 })

  const body = (await request.json().catch(() => null)) as { fileUrl?: unknown; fileName?: unknown; description?: unknown } | null
  const fileUrl = typeof body?.fileUrl === 'string' && body.fileUrl ? body.fileUrl : null
  const fileName = typeof body?.fileName === 'string' && body.fileName ? body.fileName : null
  const description = typeof body?.description === 'string' ? body.description.trim().slice(0, 6000) : ''
  if (!fileUrl && !description) return NextResponse.json({ error: 'Anexe a ordem ou cole a descrição.' }, { status: 400 })

  const extraction = fileUrl && fileName && isExtractableAttachment(fileName) ? await extractServiceOrderFromAttachment(fileUrl, fileName) : null
  const analysis = await analyzeOrderDemand({ description: description || null, scopeText: extraction?.scopeEn ?? extraction?.summaryPt ?? null, locationName: extraction?.locationName ?? null })

  return NextResponse.json({
    extraction: extraction ?? null,
    analysis,
    failed: !extraction && !analysis,
    fileReadFailed: Boolean(fileUrl) && !extraction,
  })
}
