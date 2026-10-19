import { NextResponse } from 'next/server'
import { generateTechnicalQuotePdf } from '@/lib/quote-team/agent/pdf'
import { buildAgentState, loadAgentContext } from '@/lib/quote-team/agent/server'
import { diagnosisMediaUrls } from '@/lib/quote-team/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Baixa o PDF da cotação técnica (versão aprovada; se ainda não há, a versão em rascunho marcada como "não aprovada"). Sem preços de
 * compra, tarifas, custo interno, margem ou lucro. Preços dos materiais só com ?prices=1 e SOMENTE para o administrador.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string; appointmentId: string }> }) {
  const { id, appointmentId } = await params
  const loaded = await loadAgentContext(id, appointmentId)
  if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: loaded.status })
  const { ctx } = loaded
  const state = await buildAgentState(ctx)
  if (!state.draft) return NextResponse.json({ error: 'Ainda não há cotação para baixar.' }, { status: 404 })

  const includePrices = new URL(request.url).searchParams.get('prices') === '1' && ctx.actor === 'admin'
  const approved = state.draft.draft.status === 'approved'
  const media = state.draft.media.map((m) => String((m as Record<string, unknown>).media_url))
  const pdf = await generateTechnicalQuotePdf({
    appointment: { service_order_number: ctx.appointment.service_order_number, client_po: ctx.appointment.service_order_client_po, location_name: ctx.appointment.service_order_location_name, address: ctx.appointment.address, starts_at: ctx.appointment.starts_at },
    view: state.draft,
    approved,
    approvedAt: (state.draft.draft.approved_at as string | null) ?? null,
    version: Number(state.draft.draft.version),
    includeMaterialPrices: includePrices,
    photoUrls: media.length > 0 ? media : diagnosisMediaUrls(ctx.appointment.service_order_photos),
  })
  const safe = (ctx.appointment.service_order_number ?? appointmentId).replace(/[^a-zA-Z0-9.\-_]/g, '_')
  return new NextResponse(new Uint8Array(pdf), { status: 200, headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="cotacao-tecnica-${safe}-v${state.draft.draft.version}.pdf"`, 'Cache-Control': 'no-store' } })
}
