import { NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { startQuoteAnalysis } from '@/lib/quote-team/agent/lifecycle'
import { storageHosts, verifyStoredMedia } from '@/lib/quote-team/agent/media'
import { buildAgentState, loadAgentContext } from '@/lib/quote-team/agent/server'
import { QUOTE_STAGE_HANDLERS } from '@/lib/quote-team/handlers'
import { isPipelineReady } from '@/lib/quote-team/runner'
import { diagnosisMediaUrls, kickQuoteJob } from '@/lib/quote-team/server'

export const dynamic = 'force-dynamic'

/**
 * "Gerar Cotação com IA": começa SÓ aqui (nunca por selecionar "Cotação"). Antes: confirma que a descrição e as fotos estão salvas no servidor
 * (foto que sumiu do Storage fica de fora, sem bloquear), checa permissões/unidade e cria (ou retoma) o job — um por WO. O processamento
 * roda no servidor (disparo imediato + cron por minuto): o técnico pode fechar o app.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; appointmentId: string }> }) {
  const { id, appointmentId } = await params
  const loaded = await loadAgentContext(id, appointmentId)
  if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: loaded.status })
  const { ctx } = loaded
  if (!isPipelineReady(QUOTE_STAGE_HANDLERS)) return NextResponse.json({ error: 'Análise indisponível.' }, { status: 409 })

  const body = (await request.json().catch(() => ({}))) as { photoExceptionReason?: unknown }
  const appt = ctx.appointment
  if (appt.service_order_status !== 'quote') return NextResponse.json({ error: 'Salve a ordem como "Cotação" antes de gerar a cotação com IA.' }, { status: 409 })
  const notes = appt.service_order_material_description ?? ''
  const registered = diagnosisMediaUrls(appt.service_order_photos)
  if (!notes.trim() && registered.length === 0) return NextResponse.json({ error: 'Descreva o problema e/ou salve ao menos uma foto antes de gerar a cotação.' }, { status: 409 })

  const { present, missing } = await verifyStoredMedia(registered, storageHosts())
  const result = await startQuoteAnalysis(
    { store: ctx.store },
    { unit: ctx.unit, appointmentId: appt.id, orderStatus: appt.service_order_status, notes, mediaUrls: present, photoExceptionReason: typeof body.photoExceptionReason === 'string' ? body.photoExceptionReason : null, createdBy: ctx.appUser.id },
  )
  if (result.status === 'skipped') {
    const message = result.reason === 'budget_exhausted' ? 'O orçamento de IA desta cotação acabou. Continue manualmente.' : 'Não foi possível iniciar a análise.'
    return NextResponse.json({ error: message, reason: result.reason }, { status: 409 })
  }
  if (result.status === 'started' || result.status === 'retried') waitUntil(kickQuoteJob(new URL(request.url).origin, result.job.id))

  const state = await buildAgentState(ctx)
  return NextResponse.json({ ...state, start: result.status, missing_media: missing.length }, { status: result.status === 'started' || result.status === 'retried' ? 202 : 200 })
}
