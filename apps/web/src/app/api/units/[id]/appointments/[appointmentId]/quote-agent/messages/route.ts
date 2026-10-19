import { NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { submitTechnicianInput } from '@/lib/quote-team/agent/lifecycle'
import { storageHosts, verifyStoredMedia } from '@/lib/quote-team/agent/media'
import { addQuoteMessage } from '@/lib/quote-team/agent/messages'
import type { AgentSnapshot } from '@/lib/quote-team/agent/context'
import { buildAgentState, loadAgentContext } from '@/lib/quote-team/agent/server'
import { diagnosisMediaUrls, kickQuoteJob } from '@/lib/quote-team/server'

export const dynamic = 'force-dynamic'

/**
 * Resposta ao agente ou pedido de revisão (texto + fotos já registradas na WO). Reabre o MESMO job: o orçamento da cotação acumula
 * (nenhuma revisão reinicia o teto) e uma nova versão é gerada, preservando o histórico.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; appointmentId: string }> }) {
  const { id, appointmentId } = await params
  const loaded = await loadAgentContext(id, appointmentId)
  if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: loaded.status })
  const { ctx } = loaded

  const payload = (await request.json().catch(() => null)) as { kind?: unknown; body?: unknown; skipQuestions?: unknown } | null
  if (!payload) return NextResponse.json({ error: 'Requisição inválida.' }, { status: 400 })
  const kind = payload.kind === 'revision_request' ? 'revision_request' : 'answer'
  const text = typeof payload.body === 'string' ? payload.body.slice(0, 4000) : ''

  const job = await ctx.store.findByAppointment(ctx.appointment.id)
  if (!job) return NextResponse.json({ error: 'A análise ainda não foi iniciada.' }, { status: 409 })

  // fotos NOVAS = as registradas na WO (e presentes no Storage) que a análise ainda não conhece. Assim a resposta funciona mesmo que o envio das
  // fotos tenha passado pela fila offline antes: o servidor reconcilia sozinho, sem depender de a tela saber as URLs.
  const known = new Set(((job.input_snapshot as AgentSnapshot).media_urls ?? []))
  const candidates = diagnosisMediaUrls(ctx.appointment.service_order_photos).filter((u) => !known.has(u))
  const { present: fresh } = await verifyStoredMedia(candidates, storageHosts())

  const result = await submitTechnicianInput({ store: ctx.store }, { job, kind, body: text, newMediaUrls: fresh, skipQuestions: payload.skipQuestions === true })
  if (result.status === 'rejected') {
    const messages: Record<string, string> = {
      empty: 'Escreva uma mensagem ou anexe uma foto.',
      busy: 'A análise está em andamento. Aguarde terminar para enviar a próxima mensagem.',
      budget_exhausted: 'O orçamento de IA desta cotação acabou. Continue editando a cotação manualmente.',
      max_rounds: 'Limite de revisões com a IA atingido para esta cotação. Continue editando manualmente.',
      not_reopenable: 'Esta cotação não pode receber novas mensagens agora.',
    }
    return NextResponse.json({ error: messages[result.reason] ?? 'Não foi possível enviar.', reason: result.reason }, { status: result.reason === 'busy' ? 409 : 422 })
  }

  await addQuoteMessage(ctx.db, {
    org_id: ctx.unit.org_id,
    unit_id: ctx.unit.id,
    appointment_id: ctx.appointment.id,
    job_id: job.id,
    role: ctx.actor === 'admin' ? 'admin' : 'technician',
    kind,
    body: text || (payload.skipQuestions === true ? 'Não tenho essas informações. Continue sem elas.' : null),
    media: fresh.map((url) => ({ url, kind: 'before' })),
    round: result.job.rounds,
    created_by: ctx.appUser.id,
  })
  waitUntil(kickQuoteJob(new URL(request.url).origin, job.id))
  return NextResponse.json(await buildAgentState(ctx), { status: 202 })
}
